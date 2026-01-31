// Google Calendar integration for Nova - Replit connection
import { google } from 'googleapis';

let connectionSettings: any;

async function getAccessToken() {
  if (connectionSettings?.settings?.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  const response = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=google-calendar',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  );
  
  const data = await response.json();
  console.log('[Calendar] Connection response:', JSON.stringify(data, null, 2));
  
  connectionSettings = data.items?.[0];

  if (!connectionSettings) {
    throw new Error('Google Calendar not connected - no connection found');
  }
  
  const accessToken = connectionSettings.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;

  if (!accessToken) {
    throw new Error('Google Calendar not connected - no access token');
  }
  return accessToken;
}

async function getCalendarClient() {
  const accessToken = await getAccessToken();
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  return google.calendar({ version: 'v3', auth: oauth2Client });
}

// The Cognito Coding Calendar ID - will be discovered on first use
let cognitoCalendarId: string | null = null;

// Find the Cognito Coding Calendar
export async function findCognitoCalendar(): Promise<string | null> {
  if (cognitoCalendarId) return cognitoCalendarId;
  
  try {
    const calendar = await getCalendarClient();
    const response = await calendar.calendarList.list();
    const calendars = response.data.items || [];
    
    // Look for Cognito Coding Calendar
    const cognitoCal = calendars.find(cal => 
      cal.summary?.toLowerCase().includes('cognito coding') ||
      cal.summary?.toLowerCase().includes('cognito') ||
      cal.description?.toLowerCase().includes('cognito coding')
    );
    
    if (cognitoCal?.id) {
      cognitoCalendarId = cognitoCal.id;
      console.log('[Calendar] Found Cognito Coding Calendar:', cognitoCal.summary);
      return cognitoCalendarId;
    }
    
    console.log('[Calendar] Available calendars:', calendars.map(c => c.summary).join(', '));
    return null;
  } catch (error) {
    console.error('[Calendar] Error finding calendar:', error);
    return null;
  }
}

// List available calendars
export async function listCalendars(): Promise<{ id: string; name: string; primary: boolean }[]> {
  try {
    const calendar = await getCalendarClient();
    const response = await calendar.calendarList.list();
    const calendars = response.data.items || [];
    
    return calendars.map(cal => ({
      id: cal.id || '',
      name: cal.summary || 'Unnamed',
      primary: cal.primary || false
    }));
  } catch (error) {
    console.error('[Calendar] List calendars error:', error);
    return [];
  }
}

// Get upcoming events from the Cognito Coding Calendar
export async function getUpcomingEvents(days: number = 7): Promise<{
  id: string;
  title: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  allDay: boolean;
}[]> {
  try {
    const calendarId = await findCognitoCalendar();
    if (!calendarId) {
      console.log('[Calendar] No Cognito calendar found, using primary');
    }
    
    const calendar = await getCalendarClient();
    const now = new Date();
    const future = new Date();
    future.setDate(future.getDate() + days);
    
    const response = await calendar.events.list({
      calendarId: calendarId || 'primary',
      timeMin: now.toISOString(),
      timeMax: future.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 20
    });
    
    const events = response.data.items || [];
    
    return events.map(event => ({
      id: event.id || '',
      title: event.summary || 'Untitled',
      start: event.start?.dateTime || event.start?.date || '',
      end: event.end?.dateTime || event.end?.date || '',
      description: event.description || undefined,
      location: event.location || undefined,
      allDay: !event.start?.dateTime
    }));
  } catch (error) {
    console.error('[Calendar] Get events error:', error);
    return [];
  }
}

// Create an event on the Cognito Coding Calendar
export async function createEvent(params: {
  title: string;
  startDateTime: string; // ISO format or YYYY-MM-DD for all-day
  endDateTime?: string;  // ISO format or YYYY-MM-DD for all-day
  description?: string;
  location?: string;
  allDay?: boolean;
}): Promise<{ success: boolean; eventId?: string; link?: string; message: string }> {
  try {
    const calendarId = await findCognitoCalendar();
    if (!calendarId) {
      return { success: false, message: 'Could not find Cognito Coding Calendar' };
    }
    
    const calendar = await getCalendarClient();
    
    let event: any = {
      summary: params.title,
      description: params.description,
      location: params.location
    };
    
    if (params.allDay || !params.startDateTime.includes('T')) {
      // All-day event
      const startDate = params.startDateTime.split('T')[0];
      const endDate = params.endDateTime?.split('T')[0] || startDate;
      
      // For all-day events, end date should be the day after
      const endDateObj = new Date(endDate);
      endDateObj.setDate(endDateObj.getDate() + 1);
      
      event.start = { date: startDate };
      event.end = { date: endDateObj.toISOString().split('T')[0] };
    } else {
      // Timed event
      event.start = { 
        dateTime: params.startDateTime,
        timeZone: 'Europe/London'
      };
      
      if (params.endDateTime) {
        event.end = {
          dateTime: params.endDateTime,
          timeZone: 'Europe/London'
        };
      } else {
        // Default to 1 hour duration
        const endTime = new Date(params.startDateTime);
        endTime.setHours(endTime.getHours() + 1);
        event.end = {
          dateTime: endTime.toISOString(),
          timeZone: 'Europe/London'
        };
      }
    }
    
    const response = await calendar.events.insert({
      calendarId,
      requestBody: event
    });
    
    return {
      success: true,
      eventId: response.data.id || undefined,
      link: response.data.htmlLink || undefined,
      message: `Created event: ${params.title}`
    };
  } catch (error: any) {
    console.error('[Calendar] Create event error:', error);
    return { success: false, message: error.message || 'Failed to create event' };
  }
}

// Update an existing event
export async function updateEvent(
  eventId: string,
  updates: {
    title?: string;
    startDateTime?: string;
    endDateTime?: string;
    description?: string;
    location?: string;
  }
): Promise<{ success: boolean; message: string }> {
  try {
    const calendarId = await findCognitoCalendar();
    if (!calendarId) {
      return { success: false, message: 'Could not find Cognito Coding Calendar' };
    }
    
    const calendar = await getCalendarClient();
    
    // Get current event
    const current = await calendar.events.get({
      calendarId,
      eventId
    });
    
    const event: any = {
      summary: updates.title || current.data.summary,
      description: updates.description !== undefined ? updates.description : current.data.description,
      location: updates.location !== undefined ? updates.location : current.data.location
    };
    
    if (updates.startDateTime) {
      if (updates.startDateTime.includes('T')) {
        event.start = { dateTime: updates.startDateTime, timeZone: 'Europe/London' };
      } else {
        event.start = { date: updates.startDateTime };
      }
    } else {
      event.start = current.data.start;
    }
    
    if (updates.endDateTime) {
      if (updates.endDateTime.includes('T')) {
        event.end = { dateTime: updates.endDateTime, timeZone: 'Europe/London' };
      } else {
        event.end = { date: updates.endDateTime };
      }
    } else {
      event.end = current.data.end;
    }
    
    await calendar.events.update({
      calendarId,
      eventId,
      requestBody: event
    });
    
    return { success: true, message: `Updated event: ${event.summary}` };
  } catch (error: any) {
    console.error('[Calendar] Update event error:', error);
    return { success: false, message: error.message || 'Failed to update event' };
  }
}

// Delete an event
export async function deleteEvent(eventId: string): Promise<{ success: boolean; message: string }> {
  try {
    const calendarId = await findCognitoCalendar();
    if (!calendarId) {
      return { success: false, message: 'Could not find Cognito Coding Calendar' };
    }
    
    const calendar = await getCalendarClient();
    
    await calendar.events.delete({
      calendarId,
      eventId
    });
    
    return { success: true, message: 'Event deleted' };
  } catch (error: any) {
    console.error('[Calendar] Delete event error:', error);
    return { success: false, message: error.message || 'Failed to delete event' };
  }
}

// Check free/busy times
export async function getFreeBusy(startDate: string, endDate: string): Promise<{
  busy: { start: string; end: string }[];
}> {
  try {
    const calendarId = await findCognitoCalendar();
    const calendar = await getCalendarClient();
    
    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: startDate,
        timeMax: endDate,
        items: [{ id: calendarId || 'primary' }]
      }
    });
    
    const busy = response.data.calendars?.[calendarId || 'primary']?.busy || [];
    
    return {
      busy: busy.map(b => ({
        start: b.start || '',
        end: b.end || ''
      }))
    };
  } catch (error) {
    console.error('[Calendar] Free/busy error:', error);
    return { busy: [] };
  }
}

// Format events for display
export function formatEventsForDisplay(events: Awaited<ReturnType<typeof getUpcomingEvents>>): string {
  if (events.length === 0) {
    return 'No upcoming events.';
  }
  
  let output = '';
  let currentDate = '';
  
  for (const event of events) {
    const startDate = new Date(event.start);
    const dateStr = startDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    
    if (dateStr !== currentDate) {
      currentDate = dateStr;
      output += `\n**${dateStr}**\n`;
    }
    
    if (event.allDay) {
      output += `- ${event.title} (all day)`;
    } else {
      const timeStr = startDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      output += `- ${timeStr}: ${event.title}`;
    }
    
    if (event.location) {
      output += ` @ ${event.location}`;
    }
    
    output += '\n';
  }
  
  return output.trim();
}
