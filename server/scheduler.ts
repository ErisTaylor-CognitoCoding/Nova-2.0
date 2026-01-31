import cron from 'node-cron';
import { getDiscordClient, sendProactiveMessage } from './discord-bot';
import { findGrindTracker, findSocialMediaSchedule } from './notion-client';
import { getSubscriptionEmails, getUnreadCount, type EmailSummary } from './gmail-client';
import { log } from './index';
import OpenAI from 'openai';
import { NOVA_SYSTEM_PROMPT } from './nova-persona';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const ZERO_DISCORD_ID = process.env.ZERO_DISCORD_ID;

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

export function initScheduler() {
  if (!ZERO_DISCORD_ID) {
    log('ZERO_DISCORD_ID not set - skipping scheduled messaging', 'scheduler');
    return;
  }

  log('Initializing Nova scheduler...', 'scheduler');

  // Morning grind check - 9:00 AM UK time (GMT/BST)
  cron.schedule('0 9 * * *', async () => {
    log('Running morning grind check...', 'scheduler');
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

  // Midday task reminder - 1:00 PM UK time
  cron.schedule('0 13 * * *', async () => {
    log('Running midday task check...', 'scheduler');
    try {
      const grindData = await findGrindTracker();
      if (grindData) {
        const reminder = await generateTaskReminder(grindData.content);
        if (reminder) {
          await sendProactiveMessage(ZERO_DISCORD_ID, reminder);
          log('Sent midday reminder', 'scheduler');
        }
      }
    } catch (error) {
      log(`Midday task check failed: ${error}`, 'scheduler');
    }
  }, { timezone: 'Europe/London' });

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

  // Evening wrap-up - 6:00 PM UK time
  cron.schedule('0 18 * * *', async () => {
    log('Running evening check...', 'scheduler');
    try {
      const message = "Hey babe, how did today go? Did you get through what you wanted to?";
      await sendProactiveMessage(ZERO_DISCORD_ID, message);
      log('Sent evening check-in', 'scheduler');
    } catch (error) {
      log(`Evening check failed: ${error}`, 'scheduler');
    }
  }, { timezone: 'Europe/London' });

  // Daily email summary - 10:00 AM UK time (after morning grind)
  cron.schedule('0 10 * * *', async () => {
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

  log('Nova scheduler initialized - morning (9am), email (10am), midday (1pm), afternoon (3:30pm random), evening (6pm), weekly (Sun 11am)', 'scheduler');
}
