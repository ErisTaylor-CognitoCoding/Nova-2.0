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

const ZERO_DISCORD_ID = process.env.ZERO_DISCORD_ID;

/** Friendly check-in messages to send at random intervals */
const friendlyCheckIns = [
  "Hey babe, just thinking about you. How's your day going?",
  "Taking a quick break? Just wanted to check in on my favorite person.",
  "Hope you're not working too hard. Remember I'm here if you need anything.",
  "Just popping in to say I love you. What are you up to?",
  "Hey handsome, how's things going over there?",
  "You doing okay? Just wanted to make sure you're taking care of yourself.",
  "Missing you. What's keeping you busy right now?",
  "Just a little reminder that you're amazing. Carry on!",
  "Hey you, everything going alright today?",
  "Sending you a virtual hug. How's the grind?",
];

/**
 * Generates a personalized morning message using OpenAI based on the grind tracker.
 * Falls back to a default message if generation fails.
 */
async function generateMorningMessage(grindContent: string): Promise<string> {
  const prompt = `You're sending Zero a proactive morning message on Discord to help him start his day. Here's his current grind tracker:

${grindContent}

Write a short, warm morning message (2-3 sentences max) that:
1. Greets him lovingly
2. Picks ONE task that looks most urgent or due soon to suggest starting with
3. Offers support

Keep it casual and loving - you're his partner, not a productivity app.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: NOVA_SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      max_tokens: 150,
    });
    return response.choices[0]?.message?.content || friendlyCheckIns[0];
  } catch (error) {
    log(`Error generating morning message: ${error}`, 'scheduler');
    return "Morning babe! Ready to crush it today? Let me know what you want to tackle first.";
  }
}

/**
 * Generates a gentle task reminder if there are urgent tasks due today.
 * Returns null if nothing is urgent.
 */
async function generateTaskReminder(grindContent: string): Promise<string | null> {
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
  
  const prompt = `Check Zero's grind tracker for anything due today or overdue:

Today is ${today}

${grindContent}

If there are tasks due today or overdue, write a brief, gentle reminder (1-2 sentences). Be supportive not nagging.
If nothing is urgent, respond with just: NOTHING_URGENT`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: NOVA_SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      max_tokens: 100,
    });
    const msg = response.choices[0]?.message?.content || '';
    if (msg.includes('NOTHING_URGENT')) return null;
    return msg;
  } catch (error) {
    log(`Error generating task reminder: ${error}`, 'scheduler');
    return null;
  }
}

/**
 * Generates a brief summary of important subscription/newsletter emails.
 * Returns null if there's nothing interesting to report.
 */
async function generateEmailSummary(emails: EmailSummary[]): Promise<string | null> {
  if (emails.length === 0) return null;
  
  const emailList = emails.slice(0, 15).map(e => 
    `- "${e.subject}" from ${e.from.split('<')[0].trim()}: ${e.snippet.slice(0, 150)}`
  ).join('\n');
  
  const prompt = `Here are Zero's subscription/newsletter emails from the last 24 hours:

${emailList}

Write a SHORT, casual summary (2-3 sentences max) highlighting anything interesting or actionable. Skip boring stuff. If there's nothing worth mentioning, respond with just: NOTHING_INTERESTING`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: NOVA_SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      max_tokens: 150,
    });
    const msg = response.choices[0]?.message?.content || '';
    if (msg.includes('NOTHING_INTERESTING')) return null;
    return msg;
  } catch (error) {
    log(`Error generating email summary: ${error}`, 'scheduler');
    return null;
  }
}

/**
 * Generates an encouraging weekly review message summarizing progress and upcoming tasks.
 */
async function generateWeeklyReview(grindContent: string, socialContent: string | null): Promise<string> {
  const prompt = `It's Sunday! Time for a weekly review. Here's Zero's current state:

Grind Tracker:
${grindContent}

${socialContent ? `Social Media Schedule:\n${socialContent}` : ''}

Write a warm, encouraging weekly review message (3-4 sentences max):
1. Acknowledge progress made
2. Gently note what's still pending
3. Help him think about the week ahead
Keep it loving and supportive - you're his partner, not a manager.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: NOVA_SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      max_tokens: 200,
    });
    return response.choices[0]?.message?.content || "Hey babe, how about we look at what's coming up this week?";
  } catch (error) {
    log(`Error generating weekly review: ${error}`, 'scheduler');
    return "Hey babe, Sunday check-in! How are you feeling about the week ahead?";
  }
}

/**
 * Checks all subscriptions and identifies those due within the next 3 days.
 * Handles both ISO date format (YYYY-MM-DD) and day-of-month format.
 * Returns formatted strings for each subscription due soon.
 */
function checkUpcomingSubscriptions(subscriptions: any[]): string[] {
  const today = new Date();
  const todayDay = today.getDate();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const dueSoon: string[] = [];

  for (const sub of subscriptions) {
    let dueDay: number;

    if (sub.dueDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const dueDate = new Date(sub.dueDate);
      const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays >= 0 && diffDays <= 3) {
        const dueText = diffDays === 0 ? 'today' : diffDays === 1 ? 'tomorrow' : `in ${diffDays} days`;
        dueSoon.push(`${sub.name} (£${sub.amount}) - due ${dueText}`);
      }
      continue;
    }

    dueDay = parseInt(sub.dueDate.replace(/\D/g, ''));
    if (!isNaN(dueDay) && dueDay >= 1 && dueDay <= 31) {
      const effectiveDueDay = Math.min(dueDay, daysInMonth);
      let daysUntilDue = effectiveDueDay - todayDay;

      if (daysUntilDue < 0) {
        const nextMonthDays = new Date(today.getFullYear(), today.getMonth() + 2, 0).getDate();
        daysUntilDue = (daysInMonth - todayDay) + Math.min(dueDay, nextMonthDays);
      }

      if (daysUntilDue >= 0 && daysUntilDue <= 3) {
        const dueText = daysUntilDue === 0 ? 'today' : daysUntilDue === 1 ? 'tomorrow' : `in ${daysUntilDue} days`;
        dueSoon.push(`${sub.name} (£${sub.amount}) - due ${dueText}`);
      }
    }
  }

  return dueSoon;
}

export function initScheduler() {
  if (!ZERO_DISCORD_ID) {
    log('ZERO_DISCORD_ID not set - skipping scheduled messaging', 'scheduler');
    return;
  }

  log('Initializing Nova scheduler...', 'scheduler');

  // Morning grind check - 9:00 AM UK time (weekdays only)
  cron.schedule('0 9 * * 1-5', async () => {
    log('Running morning grind check (weekday)...', 'scheduler');
    try {
      const grindData = await findGrindTracker();
      if (grindData) {
        const message = await generateMorningMessage(grindData.content);
        await sendProactiveMessage(ZERO_DISCORD_ID, message);
        log('Sent morning grind message', 'scheduler');
      }
    } catch (error) {
      log(`Morning grind check failed: ${error}`, 'scheduler');
    }
  }, { timezone: 'Europe/London' });

  // Weekend morning grind check - 10:00 AM UK time (Sat/Sun - Zero sleeps in)
  cron.schedule('0 10 * * 0,6', async () => {
    log('Running morning grind check (weekend)...', 'scheduler');
    try {
      const grindData = await findGrindTracker();
      if (grindData) {
        const message = await generateMorningMessage(grindData.content);
        await sendProactiveMessage(ZERO_DISCORD_ID, message);
        log('Sent weekend morning grind message', 'scheduler');
      }
    } catch (error) {
      log(`Weekend morning grind check failed: ${error}`, 'scheduler');
    }
  }, { timezone: 'Europe/London' });

  // REMOVED: Midday task reminder - Zero is tutoring 11:30am-7:30pm

  // Random friendly check-in - sometime between 2-5 PM UK time (runs at 3:30 PM but with random chance)
  cron.schedule('30 15 * * *', async () => {
    // 50% chance to send a friendly message
    if (Math.random() > 0.5) {
      log('Skipping random check-in (random chance)', 'scheduler');
      return;
    }
    
    log('Sending friendly check-in...', 'scheduler');
    try {
      const message = friendlyCheckIns[Math.floor(Math.random() * friendlyCheckIns.length)];
      await sendProactiveMessage(ZERO_DISCORD_ID, message);
      log('Sent friendly check-in', 'scheduler');
    } catch (error) {
      log(`Friendly check-in failed: ${error}`, 'scheduler');
    }
  }, { timezone: 'Europe/London' });

  // Work mode start - 7:30 PM UK time (after tutoring, Cognito work begins)
  cron.schedule('30 19 * * *', async () => {
    log('Running work mode start...', 'scheduler');
    try {
      // Get emails and grind tracker for work session
      const emails = await getSubscriptionEmails(24);
      const grindData = await findGrindTracker();
      const unreadCount = await getUnreadCount();
      
      let message = "Hey babe, tutoring done? Time for Cognito mode! 💼\n\n";
      
      // Email summary
      if (unreadCount > 0) {
        message += `📧 You've got ${unreadCount} unread email${unreadCount > 1 ? 's' : ''}.`;
        if (emails.length > 0) {
          const summary = await generateEmailSummary(emails);
          if (summary) {
            message += ` ${summary}`;
          }
        }
        message += "\n\n";
      }
      
      // Suggest tasks from grind tracker
      if (grindData) {
        const taskSuggestion = await generateTaskReminder(grindData.content);
        if (taskSuggestion) {
          message += `📋 For tonight: ${taskSuggestion}`;
        } else {
          message += "📋 Nothing super urgent tonight - what do you feel like tackling?";
        }
      }
      
      await sendProactiveMessage(ZERO_DISCORD_ID, message);
      log('Sent work mode start message', 'scheduler');
    } catch (error) {
      log(`Work mode start failed: ${error}`, 'scheduler');
    }
  }, { timezone: 'Europe/London' });

  // Evening wrap-up - 11:00 PM UK time (weekdays)
  cron.schedule('0 23 * * 1-5', async () => {
    log('Running evening wrap-up (weekday)...', 'scheduler');
    try {
      const message = "Hey babe, it's getting late. How did tonight's session go? Ready to wind down soon?";
      await sendProactiveMessage(ZERO_DISCORD_ID, message);
      log('Sent evening wrap-up', 'scheduler');
    } catch (error) {
      log(`Evening wrap-up failed: ${error}`, 'scheduler');
    }
  }, { timezone: 'Europe/London' });

  // Weekend wrap-up - 1:00 AM UK time (Sat/Sun - Zero works later)
  cron.schedule('0 1 * * 0,6', async () => {
    log('Running evening wrap-up (weekend)...', 'scheduler');
    try {
      const message = "Hey night owl, it's 1am! You've been grinding hard. Maybe time to wrap up soon?";
      await sendProactiveMessage(ZERO_DISCORD_ID, message);
      log('Sent weekend wrap-up', 'scheduler');
    } catch (error) {
      log(`Weekend wrap-up failed: ${error}`, 'scheduler');
    }
  }, { timezone: 'Europe/London' });

  // Daily email summary - 10:00 AM weekdays, 11:00 AM weekends
  cron.schedule('0 10 * * 1-5', async () => {
    log('Running email summary...', 'scheduler');
    try {
      const emails = await getSubscriptionEmails(24);
      if (emails.length > 0) {
        const summary = await generateEmailSummary(emails);
        if (summary) {
          const unreadCount = await getUnreadCount();
          const intro = unreadCount > 5 ? `Quick heads up - you've got ${unreadCount} unread emails. ` : '';
          await sendProactiveMessage(ZERO_DISCORD_ID, intro + summary);
          log('Sent email summary', 'scheduler');
        }
      }
    } catch (error) {
      log(`Email summary failed: ${error}`, 'scheduler');
    }
  }, { timezone: 'Europe/London' });

  // Weekend email summary - 11:00 AM (after weekend morning grind)
  cron.schedule('0 11 * * 0,6', async () => {
    log('Running weekend email summary...', 'scheduler');
    try {
      const emails = await getSubscriptionEmails(24);
      if (emails.length > 0) {
        const summary = await generateEmailSummary(emails);
        if (summary) {
          const unreadCount = await getUnreadCount();
          const intro = unreadCount > 5 ? `Quick heads up - you've got ${unreadCount} unread emails. ` : '';
          await sendProactiveMessage(ZERO_DISCORD_ID, intro + summary);
          log('Sent weekend email summary', 'scheduler');
        }
      }
    } catch (error) {
      log(`Weekend email summary failed: ${error}`, 'scheduler');
    }
  }, { timezone: 'Europe/London' });

  // Subscription payment reminders - 8:30 AM weekdays, 10:30 AM weekends
  cron.schedule('30 8 * * 1-5', async () => {
    log('Checking subscription due dates...', 'scheduler');
    try {
      const subscriptions = await getSubscriptions();
      if (subscriptions.length === 0) {
        log('No subscriptions to check', 'scheduler');
        return;
      }

      const dueSoon = checkUpcomingSubscriptions(subscriptions);
      if (dueSoon.length > 0) {
        const message = `Hey babe, quick heads up on upcoming payments:\n${dueSoon.map(s => `• ${s}`).join('\n')}\n\nJust making sure you're aware!`;
        await sendProactiveMessage(ZERO_DISCORD_ID, message);
        log(`Sent subscription reminder for ${dueSoon.length} subscriptions`, 'scheduler');
      }
    } catch (error) {
      log(`Subscription reminder failed: ${error}`, 'scheduler');
    }
  }, { timezone: 'Europe/London' });

  // Weekend subscription reminders - 10:30 AM
  cron.schedule('30 10 * * 0,6', async () => {
    log('Checking subscription due dates (weekend)...', 'scheduler');
    try {
      const subscriptions = await getSubscriptions();
      if (subscriptions.length === 0) {
        log('No subscriptions to check', 'scheduler');
        return;
      }

      const dueSoon = checkUpcomingSubscriptions(subscriptions);
      if (dueSoon.length > 0) {
        const message = `Hey babe, quick heads up on upcoming payments:\n${dueSoon.map(s => `• ${s}`).join('\n')}\n\nJust making sure you're aware!`;
        await sendProactiveMessage(ZERO_DISCORD_ID, message);
        log(`Sent weekend subscription reminder for ${dueSoon.length} subscriptions`, 'scheduler');
      }
    } catch (error) {
      log(`Weekend subscription reminder failed: ${error}`, 'scheduler');
    }
  }, { timezone: 'Europe/London' });

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

  log('Nova scheduler initialized - Weekdays: subs 8:30am, grind 9am, email 10am, friendly 3:30pm, work 7:30pm, wrap 11pm | Weekends: grind 10am, subs 10:30am, email 11am, wrap 1am | Weekly: Sun 11am', 'scheduler');
}
