import { google } from 'googleapis';

let connectionSettings: any;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
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

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=google-mail',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('Gmail not connected');
  }
  return accessToken;
}

async function getGmailClient() {
  const accessToken = await getAccessToken();

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({
    access_token: accessToken
  });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

export interface EmailSummary {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  labels: string[];
  isUnread: boolean;
}

export interface EmailDetail extends EmailSummary {
  body: string;
}

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

function extractBody(payload: any): string {
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
    }
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        const html = decodeBase64Url(part.body.data);
        return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      }
    }
    for (const part of payload.parts) {
      if (part.parts) {
        const nested = extractBody(part);
        if (nested) return nested;
      }
    }
  }
  
  return '';
}

function getHeader(headers: any[], name: string): string {
  const header = headers?.find((h: any) => h.name.toLowerCase() === name.toLowerCase());
  return header?.value || '';
}

export async function getRecentEmails(maxResults: number = 20, query?: string): Promise<EmailSummary[]> {
  try {
    const gmail = await getGmailClient();
    
    const response = await gmail.users.messages.list({
      userId: 'me',
      maxResults,
      q: query || undefined
    });

    const messages = response.data.messages || [];
    const emails: EmailSummary[] = [];

    for (const msg of messages) {
      try {
        const detail = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
          format: 'metadata',
          metadataHeaders: ['Subject', 'From', 'Date']
        });

        const headers = detail.data.payload?.headers || [];
        
        emails.push({
          id: msg.id!,
          threadId: msg.threadId!,
          subject: getHeader(headers, 'Subject') || '(No Subject)',
          from: getHeader(headers, 'From'),
          date: getHeader(headers, 'Date'),
          snippet: detail.data.snippet || '',
          labels: detail.data.labelIds || [],
          isUnread: detail.data.labelIds?.includes('UNREAD') || false
        });
      } catch (err) {
        console.error(`[gmail] Error fetching message ${msg.id}:`, err);
      }
    }

    return emails;
  } catch (error) {
    console.error('[gmail] Error fetching emails:', error);
    throw error;
  }
}

export async function getEmailDetail(messageId: string): Promise<EmailDetail | null> {
  try {
    const gmail = await getGmailClient();
    
    const response = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full'
    });

    const headers = response.data.payload?.headers || [];
    const body = extractBody(response.data.payload);

    return {
      id: response.data.id!,
      threadId: response.data.threadId!,
      subject: getHeader(headers, 'Subject') || '(No Subject)',
      from: getHeader(headers, 'From'),
      date: getHeader(headers, 'Date'),
      snippet: response.data.snippet || '',
      labels: response.data.labelIds || [],
      isUnread: response.data.labelIds?.includes('UNREAD') || false,
      body: body.slice(0, 5000)
    };
  } catch (error) {
    console.error('[gmail] Error fetching email detail:', error);
    return null;
  }
}

export async function getUnreadCount(): Promise<number> {
  try {
    const gmail = await getGmailClient();
    
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: 'is:unread',
      maxResults: 100
    });

    return response.data.resultSizeEstimate || 0;
  } catch (error) {
    console.error('[gmail] Error getting unread count:', error);
    return 0;
  }
}

export async function getSubscriptionEmails(hours: number = 24): Promise<EmailSummary[]> {
  const afterDate = new Date(Date.now() - hours * 60 * 60 * 1000);
  const afterTimestamp = Math.floor(afterDate.getTime() / 1000);
  
  return getRecentEmails(50, `after:${afterTimestamp} category:updates OR category:promotions OR label:newsletter`);
}

export async function searchEmails(query: string, maxResults: number = 10): Promise<EmailSummary[]> {
  return getRecentEmails(maxResults, query);
}

export async function getLabels(): Promise<{ id: string; name: string }[]> {
  try {
    const gmail = await getGmailClient();
    
    const response = await gmail.users.labels.list({
      userId: 'me'
    });

    return (response.data.labels || []).map(label => ({
      id: label.id!,
      name: label.name!
    }));
  } catch (error) {
    console.error('[gmail] Error fetching labels:', error);
    return [];
  }
}

export async function testConnection(): Promise<boolean> {
  try {
    const gmail = await getGmailClient();
    const profile = await gmail.users.getProfile({ userId: 'me' });
    console.log('[gmail] Connected as:', profile.data.emailAddress);
    return true;
  } catch (error) {
    console.error('[gmail] Connection test failed:', error);
    return false;
  }
}

function createRawEmail(to: string, subject: string, body: string, isHtml: boolean = false): string {
  const boundary = '----=_Part_' + Date.now();
  const contentType = isHtml ? 'text/html' : 'text/plain';
  
  const email = [
    `To: ${to}`,
    `From: Nova Spire <novaspire@cognitocoding.com>`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: ${contentType}; charset=utf-8`,
    '',
    body
  ].join('\r\n');

  return Buffer.from(email).toString('base64url');
}

export async function sendEmail(
  to: string, 
  subject: string, 
  body: string, 
  isHtml: boolean = false
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const gmail = await getGmailClient();
    const raw = createRawEmail(to, subject, body, isHtml);
    
    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw }
    });
    
    console.log('[gmail] Email sent, messageId:', response.data.id);
    return { success: true, messageId: response.data.id || undefined };
  } catch (error: any) {
    console.error('[gmail] Send email failed:', error);
    return { success: false, error: error.message || 'Failed to send email' };
  }
}
