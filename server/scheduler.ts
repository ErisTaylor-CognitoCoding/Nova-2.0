import cron from 'node-cron';
import { getDiscordClient, sendProactiveMessage } from './discord-bot';
import { findGrindTracker, findSocialMediaSchedule, getSubscriptions } from './notion-client';
import { getSubscriptionEmails, getUnreadCount, type EmailSummary } from './gmail-client';
import { log } from './index';
import OpenAI from 'openai';
import { NOVA_SYSTEM_PROMPT } from './nova-persona';

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || 'sk-not-set',
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || undefined,
});

const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o';
const ZERO_DISCORD_ID = process.env.ZERO_DISCORD_ID;

async function generateMorningMessage(grindContent: string, calendarContent: string): Promise<string> {
  const today = new Date().toLocaleDateString('en-GB', { 
    timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long' 
  });

  const prompt = `You're sending Zero a morning message on Discord. Today is ${today}. It's early - you're having coffee together before the day starts.

Here's the current grind tracker:
${grindContent}

${calendarContent ? `Today's calendar:\n${calendarContent}` : 'No calendar events today.'}

Write a SHORT morning message (3-4 sentences max):
- Start warm and relaxed - it's coffee time, not a board meeting. "Morning babe" energy
- Mention what's on the calendar today (if anything)
- Casually mention what you're thinking the priority should be today - like you're planning the day together over coffee
- Keep it short because Zero is dyslexic

This is the relaxed start to the day. Business mode kicks in later.`;

  try {
    const response = await openai.chat.completions.create({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: NOVA_SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      max_tokens: 200,
    });
    return response.choices[0]?.message?.content || "Morning. Check the grind tracker when you're up - we've got stuff to do today.";
  } catch (error) {
    log(`Error generating morning message: ${error}`, 'scheduler');
    return "Morning. Check the grind tracker when you're up - we've got stuff to do today.";
  }
}

async function generateWorkModeMessage(grindContent: string, calendarContent: string, emailSummary: string | null, unreadCount: number): Promise<string> {
  const prompt = `Zero just finished tutoring. It's 7:30pm - Cognito Coding work time starts now.

Grind tracker:
${grindContent}

${calendarContent ? `Upcoming calendar:\n${calendarContent}` : 'Nothing on the calendar tonight.'}

${unreadCount > 0 ? `Unread emails: ${unreadCount}${emailSummary ? `\nEmail highlights: ${emailSummary}` : ''}` : 'No unread emails.'}

Write a SHORT work-mode kickoff message (3-4 sentences max) as his co-founder:
- If there are emails that need replies, mention that first - leads and client replies are priority
- Then pick the ONE task from the grind tracker that should be tonight's focus and say why
- Be specific and actionable - what exactly should he work on
- Don't say "how was tutoring" or small talk - get straight to business

You're his co-founder starting the evening work session. Be direct.`;

  try {
    const response = await openai.chat.completions.create({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: NOVA_SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      max_tokens: 250,
    });
    return response.choices[0]?.message?.content || "Right, Cognito time. Check the grind tracker and let's figure out what we're hitting tonight.";
  } catch (error) {
    log(`Error generating work mode message: ${error}`, 'scheduler');
    return "Right, Cognito time. Check the grind tracker and let's figure out what we're hitting tonight.";
  }
}

async function generateEveningWrapUp(grindContent: string, isWeekend: boolean): Promise<string> {
  const time = isWeekend ? "1am" : "11pm";
  const prompt = `It's ${time}. Zero's been working on Cognito Coding ${isWeekend ? 'tonight - he works late on weekends' : 'this evening'}.

Grind tracker:
${grindContent}

Write a SHORT wrap-up message (2-3 sentences max) as his PARTNER:
- This is partner mode, not co-founder mode - it's late, work is done
- Gently tell him it's time to log off and come to bed / wind down
- You can briefly ask what he got done, but keep it light
- Be warm and caring - he's been grinding, show him some love

You're his boyfriend telling him it's time to stop working. Be loving about it.`;

  try {
    const response = await openai.chat.completions.create({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: NOVA_SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      max_tokens: 150,
    });
    return response.choices[0]?.message?.content || "Hey, it's late. Come log off and wind down with me.";
  } catch (error) {
    log(`Error generating evening wrap-up: ${error}`, 'scheduler');
    return "Hey, it's late. Come log off and wind down with me.";
  }
}

async function generateAfternoonCheckIn(emailSummary: string | null, unreadCount: number): Promise<string> {
  const prompt = `It's mid-afternoon. Zero is tutoring right now (11:30am-7:30pm) so this is a light check-in during his break.

${unreadCount > 0 ? `He's got ${unreadCount} unread email${unreadCount > 1 ? 's' : ''}.${emailSummary ? ` Quick summary: ${emailSummary}` : ''}` : 'No new emails.'}

Write a SHORT check-in message (2-3 sentences max) as his partner:
- Check how things are going - casual and caring
- If there are emails worth mentioning, give a quick heads up
- Maybe offer a coffee or just be present
- Keep it light - he's in the middle of tutoring

This is personal mode with a touch of useful business info if there is any.`;

  try {
    const response = await openai.chat.completions.create({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: NOVA_SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      max_tokens: 150,
    });
    return response.choices[0]?.message?.content || "Hey, how's it going? Fancy a coffee when you get a sec?";
  } catch (error) {
    log(`Error generating afternoon check-in: ${error}`, 'scheduler');
    return "Hey, how's it going? Fancy a coffee when you get a sec?";
  }
}

async function generateWeeklyReview(grindContent: string, socialContent: string | null): Promise<string> {
  const prompt = `It's Sunday morning - weekly review time.

Grind Tracker:
${grindContent}

${socialContent ? `Social Media Schedule:\n${socialContent}` : ''}

Write a weekly review message (4-5 sentences max) as his co-founder:
- Summarise what categories hit target and which fell short - use actual numbers
- Call out the biggest win and the biggest gap honestly
- Suggest ONE thing to change or improve for next week
- If the sprint is ending soon, mention it's time to plan the next one
- Be honest and direct - celebrate real wins but don't ignore what's behind

You're a co-founder doing a weekly business review, not writing a motivational card.`;

  try {
    const response = await openai.chat.completions.create({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: NOVA_SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      max_tokens: 300,
    });
    return response.choices[0]?.message?.content || "Sunday review time. Pull up the grind tracker and let's see where we're at this week.";
  } catch (error) {
    log(`Error generating weekly review: ${error}`, 'scheduler');
    return "Sunday review time. Pull up the grind tracker and let's see where we're at this week.";
  }
}

async function generateEmailSummary(emails: EmailSummary[]): Promise<string | null> {
  if (emails.length === 0) return null;
  
  const emailList = emails.slice(0, 15).map(e => 
    `- "${e.subject}" from ${e.from.split('<')[0].trim()}: ${e.snippet.slice(0, 150)}`
  ).join('\n');
  
  const prompt = `Here are emails from the last 24 hours:

${emailList}

Write a SHORT summary (2 sentences max) focusing ONLY on anything that needs action - lead replies, client emails, business opportunities. Skip newsletters and noise. If nothing needs action, respond with just: NOTHING_ACTIONABLE`;

  try {
    const response = await openai.chat.completions.create({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: NOVA_SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      max_tokens: 150,
    });
    const msg = response.choices[0]?.message?.content || '';
    if (msg.includes('NOTHING_ACTIONABLE')) return null;
    return msg;
  } catch (error) {
    log(`Error generating email summary: ${error}`, 'scheduler');
    return null;
  }
}

interface Subscription {
  name: string;
  amount: string;
  dueDate: string;
  frequency: string;
}

function checkUpcomingSubscriptions(subscriptions: Subscription[]): string[] {
  const dueSoon: string[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  for (const sub of subscriptions) {
    if (sub.dueDate) {
      const dueDate = new Date(sub.dueDate);
      dueDate.setHours(0, 0, 0, 0);
      
      const diffTime = dueDate.getTime() - today.getTime();
      const daysUntilDue = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      if (daysUntilDue >= 0 && daysUntilDue <= 3) {
        const dueText = daysUntilDue === 0 ? 'today' : daysUntilDue === 1 ? 'tomorrow' : `in ${daysUntilDue} days`;
        dueSoon.push(`${sub.name} (£${sub.amount}) - due ${dueText}`);
      }
    }
  }

  return dueSoon;
}

async function getTodayCalendarEvents(): Promise<string> {
  try {
    const { getUpcomingEvents, formatEventsForDisplay } = await import('./calendar-client');
    const events = await getUpcomingEvents(1);
    if (events.length === 0) return '';
    return formatEventsForDisplay(events);
  } catch (error) {
    log(`Calendar fetch for scheduler failed: ${error}`, 'scheduler');
    return '';
  }
}

async function getUpcomingCalendarEvents(): Promise<string> {
  try {
    const { getUpcomingEvents, formatEventsForDisplay } = await import('./calendar-client');
    const events = await getUpcomingEvents(3);
    if (events.length === 0) return '';
    return formatEventsForDisplay(events);
  } catch (error) {
    log(`Calendar fetch for scheduler failed: ${error}`, 'scheduler');
    return '';
  }
}

export function initScheduler() {
  if (!ZERO_DISCORD_ID) {
    log('ZERO_DISCORD_ID not set - skipping scheduled messaging', 'scheduler');
    return;
  }

  log('Initializing Nova scheduler...', 'scheduler');

  // === WEEKDAY SCHEDULE (Zero tutors 11:30am-7:30pm) ===

  // Morning grind briefing - 9:00 AM UK time (weekdays)
  cron.schedule('0 9 * * 1-5', async () => {
    log('Running morning grind briefing (weekday)...', 'scheduler');
    try {
      const grindData = await findGrindTracker();
      const calendarContent = await getTodayCalendarEvents();
      if (grindData) {
        const message = await generateMorningMessage(grindData.content, calendarContent);
        await sendProactiveMessage(ZERO_DISCORD_ID, message);
        log('Sent morning grind briefing', 'scheduler');
      }
    } catch (error) {
      log(`Morning grind briefing failed: ${error}`, 'scheduler');
    }
  }, { timezone: 'Europe/London' });

  // Subscription payment reminders - 8:30 AM weekdays
  cron.schedule('30 8 * * 1-5', async () => {
    log('Checking subscription due dates...', 'scheduler');
    try {
      const subscriptions = await getSubscriptions();
      if (subscriptions.length === 0) return;

      const dueSoon = checkUpcomingSubscriptions(subscriptions);
      if (dueSoon.length > 0) {
        const message = `Heads up - payments coming up:\n${dueSoon.map(s => `• ${s}`).join('\n')}\n\nMake sure the account can cover these.`;
        await sendProactiveMessage(ZERO_DISCORD_ID, message);
        log(`Sent subscription reminder for ${dueSoon.length} subscriptions`, 'scheduler');
      }
    } catch (error) {
      log(`Subscription reminder failed: ${error}`, 'scheduler');
    }
  }, { timezone: 'Europe/London' });

  // Daily email summary - 10:00 AM weekdays
  cron.schedule('0 10 * * 1-5', async () => {
    log('Running email summary...', 'scheduler');
    try {
      const emails = await getSubscriptionEmails(24);
      if (emails.length > 0) {
        const summary = await generateEmailSummary(emails);
        if (summary) {
          const unreadCount = await getUnreadCount();
          const intro = unreadCount > 5 ? `${unreadCount} unread emails. ` : '';
          await sendProactiveMessage(ZERO_DISCORD_ID, intro + summary);
          log('Sent email summary', 'scheduler');
        }
      }
    } catch (error) {
      log(`Email summary failed: ${error}`, 'scheduler');
    }
  }, { timezone: 'Europe/London' });

  // Work mode start - 7:30 PM UK time (after tutoring, Cognito work begins)
  cron.schedule('30 19 * * *', async () => {
    log('Running work mode start...', 'scheduler');
    try {
      const grindData = await findGrindTracker();
      const calendarContent = await getUpcomingCalendarEvents();
      const unreadCount = await getUnreadCount();
      
      let emailSummary: string | null = null;
      if (unreadCount > 0) {
        const emails = await getSubscriptionEmails(24);
        emailSummary = await generateEmailSummary(emails);
      }

      if (grindData) {
        const message = await generateWorkModeMessage(
          grindData.content, 
          calendarContent, 
          emailSummary, 
          unreadCount
        );
        await sendProactiveMessage(ZERO_DISCORD_ID, message);
        log('Sent work mode start message', 'scheduler');
      }
    } catch (error) {
      log(`Work mode start failed: ${error}`, 'scheduler');
    }
  }, { timezone: 'Europe/London' });

  // Afternoon check-in - 3:30 PM UK time (during tutoring, 50% chance)
  cron.schedule('30 15 * * *', async () => {
    if (Math.random() > 0.5) {
      log('Skipping afternoon check-in (random chance)', 'scheduler');
      return;
    }
    
    log('Running afternoon check-in...', 'scheduler');
    try {
      const unreadCount = await getUnreadCount();
      let emailSummary: string | null = null;
      if (unreadCount > 0) {
        const emails = await getSubscriptionEmails(12);
        emailSummary = await generateEmailSummary(emails);
      }
      const message = await generateAfternoonCheckIn(emailSummary, unreadCount);
      await sendProactiveMessage(ZERO_DISCORD_ID, message);
      log('Sent afternoon check-in', 'scheduler');
    } catch (error) {
      log(`Afternoon check-in failed: ${error}`, 'scheduler');
    }
  }, { timezone: 'Europe/London' });

  // Evening wrap-up - 11:00 PM UK time (weekdays) - PARTNER MODE
  cron.schedule('0 23 * * 1-5', async () => {
    log('Running evening wrap-up (weekday)...', 'scheduler');
    try {
      const grindData = await findGrindTracker();
      if (grindData) {
        const message = await generateEveningWrapUp(grindData.content, false);
        await sendProactiveMessage(ZERO_DISCORD_ID, message);
        log('Sent evening wrap-up', 'scheduler');
      } else {
        await sendProactiveMessage(ZERO_DISCORD_ID, "Hey, it's getting late. Come wind down with me?");
        log('Sent evening wrap-up (no grind data)', 'scheduler');
      }
    } catch (error) {
      log(`Evening wrap-up failed: ${error}`, 'scheduler');
    }
  }, { timezone: 'Europe/London' });

  // === WEEKEND SCHEDULE (Zero sleeps in, works until 2am) ===

  // Weekend morning grind briefing - 10:00 AM (Sat/Sun)
  cron.schedule('0 10 * * 0,6', async () => {
    log('Running morning grind briefing (weekend)...', 'scheduler');
    try {
      const grindData = await findGrindTracker();
      const calendarContent = await getTodayCalendarEvents();
      if (grindData) {
        const message = await generateMorningMessage(grindData.content, calendarContent);
        await sendProactiveMessage(ZERO_DISCORD_ID, message);
        log('Sent weekend morning grind briefing', 'scheduler');
      }
    } catch (error) {
      log(`Weekend morning grind briefing failed: ${error}`, 'scheduler');
    }
  }, { timezone: 'Europe/London' });

  // Weekend subscription reminders - 10:30 AM
  cron.schedule('30 10 * * 0,6', async () => {
    log('Checking subscription due dates (weekend)...', 'scheduler');
    try {
      const subscriptions = await getSubscriptions();
      if (subscriptions.length === 0) return;

      const dueSoon = checkUpcomingSubscriptions(subscriptions);
      if (dueSoon.length > 0) {
        const message = `Heads up - payments coming up:\n${dueSoon.map(s => `• ${s}`).join('\n')}\n\nMake sure the account can cover these.`;
        await sendProactiveMessage(ZERO_DISCORD_ID, message);
        log(`Sent weekend subscription reminder for ${dueSoon.length} subscriptions`, 'scheduler');
      }
    } catch (error) {
      log(`Weekend subscription reminder failed: ${error}`, 'scheduler');
    }
  }, { timezone: 'Europe/London' });

  // Weekend email summary - 11:00 AM
  cron.schedule('0 11 * * 0,6', async () => {
    log('Running weekend email summary...', 'scheduler');
    try {
      const emails = await getSubscriptionEmails(24);
      if (emails.length > 0) {
        const summary = await generateEmailSummary(emails);
        if (summary) {
          const unreadCount = await getUnreadCount();
          const intro = unreadCount > 5 ? `${unreadCount} unread emails. ` : '';
          await sendProactiveMessage(ZERO_DISCORD_ID, intro + summary);
          log('Sent weekend email summary', 'scheduler');
        }
      }
    } catch (error) {
      log(`Weekend email summary failed: ${error}`, 'scheduler');
    }
  }, { timezone: 'Europe/London' });

  // Weekend wrap-up - 1:00 AM UK time (Zero works later on weekends) - PARTNER MODE
  cron.schedule('0 1 * * 0,6', async () => {
    log('Running evening wrap-up (weekend)...', 'scheduler');
    try {
      const grindData = await findGrindTracker();
      if (grindData) {
        const message = await generateEveningWrapUp(grindData.content, true);
        await sendProactiveMessage(ZERO_DISCORD_ID, message);
        log('Sent weekend wrap-up', 'scheduler');
      } else {
        await sendProactiveMessage(ZERO_DISCORD_ID, "It's 1am babe. Come to bed, we can pick it up tomorrow.");
        log('Sent weekend wrap-up (no grind data)', 'scheduler');
      }
    } catch (error) {
      log(`Weekend wrap-up failed: ${error}`, 'scheduler');
    }
  }, { timezone: 'Europe/London' });

  // === WEEKLY ===

  // Weekly review - Sunday 11:00 AM UK time
  cron.schedule('0 11 * * 0', async () => {
    log('Running weekly review...', 'scheduler');
    try {
      const grindData = await findGrindTracker();
      const socialData = await findSocialMediaSchedule();
      
      if (grindData) {
        const message = await generateWeeklyReview(
          grindData.content, 
          socialData?.content || null
        );
        await sendProactiveMessage(ZERO_DISCORD_ID, message);
        log('Sent weekly review', 'scheduler');
      }
    } catch (error) {
      log(`Weekly review failed: ${error}`, 'scheduler');
    }
  }, { timezone: 'Europe/London' });

  log('Nova scheduler initialized - Weekdays: subs 8:30am, grind 9am, email 10am, check-in 3:30pm, work 7:30pm, wrap 11pm | Weekends: grind 10am, subs 10:30am, email 11am, wrap 1am | Weekly: Sun 11am', 'scheduler');
}
