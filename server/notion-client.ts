// Notion integration for Nova - Replit connection
import { Client } from '@notionhq/client';

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
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=notion',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('Notion not connected');
  }
  return accessToken;
}

async function getNotionClient() {
  const accessToken = await getAccessToken();
  return new Client({ auth: accessToken });
}

export async function searchNotionPages(query: string): Promise<{ title: string; id: string; url: string }[]> {
  try {
    const notion = await getNotionClient();
    const response = await notion.search({
      query,
      filter: { property: 'object', value: 'page' },
      page_size: 10
    });

    return response.results.map((page: any) => {
      const title = page.properties?.title?.title?.[0]?.plain_text 
        || page.properties?.Name?.title?.[0]?.plain_text
        || 'Untitled';
      return {
        title,
        id: page.id,
        url: page.url
      };
    });
  } catch (error) {
    console.error('Notion search error:', error);
    throw error;
  }
}

export async function getPageContent(pageId: string): Promise<string> {
  try {
    const notion = await getNotionClient();
    
    const blocks = await notion.blocks.children.list({
      block_id: pageId,
      page_size: 100
    });

    let content = '';
    
    for (const block of blocks.results as any[]) {
      const text = extractTextFromBlock(block);
      if (text) {
        content += text + '\n';
      }
    }

    return content.trim();
  } catch (error) {
    console.error('Notion page content error:', error);
    throw error;
  }
}

function extractTextFromBlock(block: any): string {
  const type = block.type;
  const data = block[type];
  
  if (!data) return '';

  if (data.rich_text) {
    const text = data.rich_text.map((t: any) => t.plain_text).join('');
    
    switch (type) {
      case 'heading_1':
        return `# ${text}`;
      case 'heading_2':
        return `## ${text}`;
      case 'heading_3':
        return `### ${text}`;
      case 'bulleted_list_item':
        return `- ${text}`;
      case 'numbered_list_item':
        return `• ${text}`;
      case 'to_do':
        const checked = data.checked ? '[x]' : '[ ]';
        return `${checked} ${text}`;
      case 'toggle':
        return `▸ ${text}`;
      default:
        return text;
    }
  }

  if (type === 'divider') return '---';
  if (type === 'code') {
    return `\`\`\`\n${data.rich_text?.map((t: any) => t.plain_text).join('') || ''}\n\`\`\``;
  }

  return '';
}

// Zero's grind tracker database ID
const GRIND_TRACKER_DB_ID = '2f20031680ec80d2b97aebaaace92509';
const GRIND_TRACKER_URL = 'https://www.notion.so/2f20031680ec80d2b97aebaaace92509';

// Social Media Monthly Schedule database ID
const SOCIAL_MEDIA_DB_ID = '2f30031680ec80058550ce7816694937';
const SOCIAL_MEDIA_URL = 'https://www.notion.so/2f30031680ec80058550ce7816694937';

// Cognito Coding Accounts - this is a page, not a database
const ACCOUNTS_PAGE_ID = '2f90031680ec817bbc60eca572a9a521';
const ACCOUNTS_URL = 'https://www.notion.so/2f90031680ec817bbc60eca572a9a521';

// Companies CRM database - will be looked up dynamically
let COMPANIES_CRM_DB_ID: string | null = null;

// Subscription tracking interface
interface Subscription {
  name: string;
  amount: number;
  frequency: 'monthly' | 'yearly' | 'weekly' | 'quarterly';
  dueDate: string; // Day of month for monthly, or full date
  category?: string;
}

interface Transaction {
  type: 'income' | 'expense';
  description: string;
  amount: number;
  date: string;
  category?: string;
}

interface GrindTask {
  title: string;
  status: string;
  progress: number | null;
  daysRemaining: number | null;
  startDate: string | null;
  endDate: string | null;
}

interface GrindEntry {
  id: string;
  title: string;
  status: string;
  progress: number | null;
  daysRemaining: number | null;
  pageContent: string;
}

async function queryGrindTrackerDatabase(): Promise<GrindEntry[]> {
  try {
    const notion = await getNotionClient();
    
    const response = await notion.databases.query({
      database_id: GRIND_TRACKER_DB_ID,
      page_size: 10
    });

    const entries: GrindEntry[] = [];
    
    for (const page of response.results as any[]) {
      const props = page.properties;
      
      const title = props.Title?.title?.[0]?.plain_text 
        || props.Name?.title?.[0]?.plain_text 
        || 'Untitled';
      
      if (title === 'Untitled') continue;
      
      const status = props.Status?.status?.name 
        || props.Status?.select?.name 
        || '';
      
      const progress = props.Progress?.number ?? null;
      const daysRemaining = props['Days Remaining']?.number ?? null;
      
      // Get the page content (nested goals and tasks)
      let pageContent = '';
      try {
        pageContent = await getPageContent(page.id);
      } catch (e) {
        console.error('Failed to get page content for:', title);
      }
      
      entries.push({
        id: page.id,
        title,
        status,
        progress,
        daysRemaining,
        pageContent
      });
    }
    
    return entries;
  } catch (error) {
    console.error('Error querying grind tracker database:', error);
    throw error;
  }
}

function formatGrindTrackerContent(entries: GrindEntry[]): string {
  if (entries.length === 0) {
    return 'No entries in the grind tracker yet.';
  }
  
  let content = '';
  
  for (const entry of entries) {
    content += `## ${entry.title}`;
    if (entry.status) content += ` [${entry.status}]`;
    if (entry.progress !== null) content += ` - ${entry.progress}% complete`;
    content += '\n\n';
    
    if (entry.pageContent) {
      content += entry.pageContent + '\n\n';
    }
  }
  
  return content.trim() || 'No active entries found.';
}

export async function findGrindTracker(): Promise<{ content: string; url: string } | null> {
  try {
    const entries = await queryGrindTrackerDatabase();
    const content = formatGrindTrackerContent(entries);
    
    return {
      content,
      url: GRIND_TRACKER_URL
    };
  } catch (error) {
    console.error('Error finding grind tracker:', error);
    return null;
  }
}

interface SocialMediaPost {
  title: string;
  date: string | null;
  platform: string;
  status: string;
  service: string;
  type: string;
  content: string;
}

async function querySocialMediaDatabase(): Promise<SocialMediaPost[]> {
  try {
    const notion = await getNotionClient();
    
    const response = await notion.databases.query({
      database_id: SOCIAL_MEDIA_DB_ID,
      page_size: 50,
      sorts: [{ property: 'Date', direction: 'ascending' }]
    });

    const posts: SocialMediaPost[] = [];
    
    for (const page of response.results as any[]) {
      const props = page.properties;
      
      const title = props.Title?.title?.[0]?.plain_text 
        || props.Name?.title?.[0]?.plain_text 
        || 'Untitled';
      
      if (title === 'Untitled') continue;
      
      const date = props.Date?.date?.start || null;
      
      const platform = props.Platform?.select?.name 
        || props.Platform?.multi_select?.map((p: any) => p.name).join(', ')
        || '';
      
      const status = props.Status?.status?.name 
        || props.Status?.select?.name 
        || '';
      
      const service = props.Service?.select?.name 
        || props.Service?.multi_select?.map((s: any) => s.name).join(', ')
        || '';
      
      const type = props.Type?.select?.name || '';
      
      const content = props.Content?.rich_text?.[0]?.plain_text || '';
      
      posts.push({
        title,
        date,
        platform,
        status,
        service,
        type,
        content
      });
    }
    
    return posts;
  } catch (error) {
    console.error('Error querying social media database:', error);
    throw error;
  }
}

function formatSocialMediaContent(posts: SocialMediaPost[]): string {
  if (posts.length === 0) {
    return 'No posts scheduled yet.';
  }
  
  let formatted = '';
  
  for (const post of posts) {
    let line = `- ${post.title}`;
    if (post.date) line += ` (${post.date})`;
    if (post.platform) line += ` [${post.platform}]`;
    if (post.status) line += ` - ${post.status}`;
    if (post.type) line += ` | ${post.type}`;
    if (post.service) line += ` | ${post.service}`;
    
    formatted += line + '\n';
  }
  
  return formatted.trim() || 'No posts found.';
}

export async function findSocialMediaSchedule(): Promise<{ content: string; url: string } | null> {
  try {
    const posts = await querySocialMediaDatabase();
    const content = formatSocialMediaContent(posts);
    
    return {
      content,
      url: SOCIAL_MEDIA_URL
    };
  } catch (error) {
    console.error('Error finding social media schedule:', error);
    return null;
  }
}

// ============ WRITE CAPABILITIES ============

export async function updateGrindTaskStatus(taskTitle: string, newStatus: string): Promise<{ success: boolean; message: string }> {
  try {
    const notion = await getNotionClient();
    
    // Find the task by title
    const response = await notion.databases.query({
      database_id: GRIND_TRACKER_DB_ID,
      filter: {
        or: [
          { property: 'Title', title: { contains: taskTitle } },
          { property: 'Name', title: { contains: taskTitle } }
        ]
      }
    });

    if (response.results.length === 0) {
      return { success: false, message: `Couldn't find a task matching "${taskTitle}"` };
    }

    const page = response.results[0];
    
    await notion.pages.update({
      page_id: page.id,
      properties: {
        Status: { status: { name: newStatus } }
      }
    });

    return { success: true, message: `Updated "${taskTitle}" to ${newStatus}` };
  } catch (error) {
    console.error('Error updating grind task:', error);
    return { success: false, message: `Failed to update task: ${error}` };
  }
}

export async function addGrindTask(title: string, status: string = 'Not started'): Promise<{ success: boolean; message: string }> {
  try {
    const notion = await getNotionClient();
    
    await notion.pages.create({
      parent: { database_id: GRIND_TRACKER_DB_ID },
      properties: {
        Title: { title: [{ text: { content: title } }] },
        Status: { status: { name: status } }
      }
    });

    return { success: true, message: `Added "${title}" to your grind tracker` };
  } catch (error) {
    console.error('Error adding grind task:', error);
    return { success: false, message: `Failed to add task: ${error}` };
  }
}

export async function updateSocialMediaPostStatus(postTitle: string, newStatus: string): Promise<{ success: boolean; message: string }> {
  try {
    const notion = await getNotionClient();
    
    // Find the post by title
    const response = await notion.databases.query({
      database_id: SOCIAL_MEDIA_DB_ID,
      filter: {
        or: [
          { property: 'Title', title: { contains: postTitle } },
          { property: 'Name', title: { contains: postTitle } }
        ]
      }
    });

    if (response.results.length === 0) {
      return { success: false, message: `Couldn't find a post matching "${postTitle}"` };
    }

    const page = response.results[0];
    
    await notion.pages.update({
      page_id: page.id,
      properties: {
        Status: { status: { name: newStatus } }
      }
    });

    return { success: true, message: `Updated "${postTitle}" to ${newStatus}` };
  } catch (error) {
    console.error('Error updating social media post:', error);
    return { success: false, message: `Failed to update post: ${error}` };
  }
}

export async function addSocialMediaPost(
  title: string, 
  date: string, 
  platform: string,
  status: string = 'Not started'
): Promise<{ success: boolean; message: string }> {
  try {
    const notion = await getNotionClient();
    
    await notion.pages.create({
      parent: { database_id: SOCIAL_MEDIA_DB_ID },
      properties: {
        Title: { title: [{ text: { content: title } }] },
        Date: { date: { start: date } },
        Platform: { select: { name: platform } },
        Status: { status: { name: status } }
      }
    });

    return { success: true, message: `Added "${title}" to your social media schedule for ${date}` };
  } catch (error) {
    console.error('Error adding social media post:', error);
    return { success: false, message: `Failed to add post: ${error}` };
  }
}

// Get available status options for grind tracker
export async function getGrindStatusOptions(): Promise<string[]> {
  try {
    const notion = await getNotionClient();
    const db = await notion.databases.retrieve({ database_id: GRIND_TRACKER_DB_ID });
    const statusProp = (db.properties as any).Status;
    if (statusProp?.status?.options) {
      return statusProp.status.options.map((opt: any) => opt.name);
    }
    return ['Not started', 'In progress', 'Done'];
  } catch (error) {
    return ['Not started', 'In progress', 'Done'];
  }
}

// Get available status options for social media
export async function getSocialMediaStatusOptions(): Promise<string[]> {
  try {
    const notion = await getNotionClient();
    const db = await notion.databases.retrieve({ database_id: SOCIAL_MEDIA_DB_ID });
    const statusProp = (db.properties as any).Status;
    if (statusProp?.status?.options) {
      return statusProp.status.options.map((opt: any) => opt.name);
    }
    return ['Not started', 'In progress', 'Done', 'Posted'];
  } catch (error) {
    return ['Not started', 'In progress', 'Done', 'Posted'];
  }
}

// Cognito Coding Accounts - Financial summaries (reads the accounts page directly)
export async function getAccountsSummary(): Promise<string> {
  try {
    // Read the accounts page content directly
    const pageContent = await getPageContent(ACCOUNTS_PAGE_ID);
    
    if (!pageContent || pageContent.trim() === '') {
      return `## Cognito Coding Accounts\nNo financial records found yet.\n\n[View in Notion](${ACCOUNTS_URL})`;
    }

    let summary = `## Cognito Coding Accounts\n\n${pageContent}\n\n[View in Notion](${ACCOUNTS_URL})`;
    return summary;
  } catch (error) {
    console.error('Accounts fetch error:', error);
    return 'Could not fetch accounts data from Notion.';
  }
}

// Query any database by name and search term
export async function queryDatabaseByName(databaseName: string, searchTerm?: string): Promise<{ found: boolean; data: any[]; dbName: string }> {
  try {
    const notion = await getNotionClient();
    
    // First, find the database by name
    const searchResponse = await notion.search({
      query: databaseName,
      filter: { property: 'object', value: 'database' }
    });
    
    const db = searchResponse.results.find((r: any) => {
      const title = r.title?.[0]?.plain_text?.toLowerCase() || '';
      return title.includes(databaseName.toLowerCase());
    }) as any;
    
    if (!db) {
      console.log(`[Notion] Database "${databaseName}" not found`);
      return { found: false, data: [], dbName: databaseName };
    }
    
    console.log(`[Notion] Found database: ${db.title?.[0]?.plain_text}, ID: ${db.id}`);
    
    // Query the database
    const queryParams: any = {
      database_id: db.id,
      page_size: 50
    };
    
    // If there's a search term, try to filter
    if (searchTerm) {
      // We'll get all entries and filter client-side since we don't know the schema
    }
    
    const response = await notion.databases.query(queryParams);
    console.log(`[Notion] Query returned ${response.results.length} raw entries`);
    
    const entries: any[] = [];
    for (const page of response.results as any[]) {
      const props = page.properties;
      const entry: any = { id: page.id };
      
      // Extract all properties
      for (const [key, value] of Object.entries(props) as any[]) {
        if (value.title) {
          entry[key] = value.title[0]?.plain_text || '';
        } else if (value.rich_text) {
          entry[key] = value.rich_text[0]?.plain_text || '';
        } else if (value.email) {
          entry[key] = value.email || '';
        } else if (value.phone_number) {
          entry[key] = value.phone_number || '';
        } else if (value.url) {
          entry[key] = value.url || '';
        } else if (value.select) {
          entry[key] = value.select?.name || '';
        } else if (value.status) {
          entry[key] = value.status?.name || '';
        } else if (value.number) {
          entry[key] = value.number;
        } else if (value.checkbox) {
          entry[key] = value.checkbox;
        }
      }
      
      // If searching, filter by search term
      if (searchTerm) {
        const entryText = JSON.stringify(entry).toLowerCase();
        const searchLower = searchTerm.toLowerCase();
        console.log(`[Notion] Checking entry: ${entryText.substring(0, 100)}... for "${searchLower}"`);
        if (entryText.includes(searchLower)) {
          console.log(`[Notion] MATCH FOUND!`);
          entries.push(entry);
        }
      } else {
        entries.push(entry);
      }
    }
    
    console.log(`[Notion] Found ${entries.length} entries in ${databaseName}`);
    return { found: true, data: entries, dbName: db.title?.[0]?.plain_text || databaseName };
  } catch (error) {
    console.error(`[Notion] Error querying database ${databaseName}:`, error);
    return { found: false, data: [], dbName: databaseName };
  }
}

// Add a subscription to the accounts page
export async function addSubscription(name: string, amount: number, frequency: string, dueDate: string, category?: string): Promise<{ success: boolean; message: string }> {
  try {
    const notion = await getNotionClient();
    
    const subscriptionText = `${name} - £${amount.toFixed(2)} (${frequency}) - Due: ${dueDate}${category ? ` [${category}]` : ''}`;
    
    // Find the "Recurring Subscriptions" section and add below it
    const blocks = await notion.blocks.children.list({
      block_id: ACCOUNTS_PAGE_ID,
      page_size: 100
    });
    
    // Find the subscriptions heading
    let subscriptionsBlockId: string | null = null;
    for (const block of blocks.results as any[]) {
      if (block.type === 'heading_2' && block.heading_2?.rich_text?.[0]?.plain_text?.includes('Recurring Subscriptions')) {
        subscriptionsBlockId = block.id;
        break;
      }
    }
    
    if (subscriptionsBlockId) {
      // Add after the subscriptions heading
      await notion.blocks.children.append({
        block_id: subscriptionsBlockId,
        children: [{
          object: 'block',
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: [{ type: 'text', text: { content: subscriptionText } }]
          }
        }]
      });
    } else {
      // Add at the end of the page
      await notion.blocks.children.append({
        block_id: ACCOUNTS_PAGE_ID,
        children: [{
          object: 'block',
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: [{ type: 'text', text: { content: subscriptionText } }]
          }
        }]
      });
    }
    
    return { success: true, message: `Added subscription: ${name} - £${amount.toFixed(2)} ${frequency}` };
  } catch (error) {
    console.error('Add subscription error:', error);
    return { success: false, message: 'Failed to add subscription to Notion' };
  }
}

// Add income to the accounts page
export async function addIncome(description: string, amount: number, date: string, category?: string): Promise<{ success: boolean; message: string }> {
  try {
    const notion = await getNotionClient();
    
    const incomeText = `${date}: ${description} - £${amount.toFixed(2)}${category ? ` [${category}]` : ''}`;
    
    // Find the "Recent Income" section
    const blocks = await notion.blocks.children.list({
      block_id: ACCOUNTS_PAGE_ID,
      page_size: 100
    });
    
    let incomeBlockId: string | null = null;
    for (const block of blocks.results as any[]) {
      if (block.type === 'heading_2' && block.heading_2?.rich_text?.[0]?.plain_text?.includes('Recent Income')) {
        incomeBlockId = block.id;
        break;
      }
    }
    
    const targetBlock = incomeBlockId || ACCOUNTS_PAGE_ID;
    
    await notion.blocks.children.append({
      block_id: targetBlock,
      children: [{
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [{ type: 'text', text: { content: incomeText } }]
        }
      }]
    });
    
    // Update the total income in Financial Summary
    await updateFinancialTotals();
    
    return { success: true, message: `Added income: £${amount.toFixed(2)} from ${description}` };
  } catch (error) {
    console.error('Add income error:', error);
    return { success: false, message: 'Failed to add income to Notion' };
  }
}

// Add expense to the accounts page
export async function addExpense(description: string, amount: number, date: string, category?: string): Promise<{ success: boolean; message: string }> {
  try {
    const notion = await getNotionClient();
    
    const expenseText = `${date}: ${description} - £${amount.toFixed(2)}${category ? ` [${category}]` : ''}`;
    
    // Find the "Recent Expenses" section
    const blocks = await notion.blocks.children.list({
      block_id: ACCOUNTS_PAGE_ID,
      page_size: 100
    });
    
    // Find the index after "Recent Expenses" heading to know where to insert
    // But since we can't insert at specific index, we append to the page
    // The expense will appear at the end - user can reorganize if needed
    
    await notion.blocks.children.append({
      block_id: ACCOUNTS_PAGE_ID,
      children: [{
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [{ type: 'text', text: { content: expenseText } }]
        }
      }]
    });
    
    await updateFinancialTotals();
    
    return { success: true, message: `Added expense: £${amount.toFixed(2)} for ${description}` };
  } catch (error) {
    console.error('Add expense error:', error);
    return { success: false, message: 'Failed to add expense to Notion' };
  }
}

// Helper to update the financial summary totals
async function updateFinancialTotals(): Promise<void> {
  try {
    const notion = await getNotionClient();
    const pageContent = await getPageContent(ACCOUNTS_PAGE_ID);
    
    // Parse income entries
    const incomeMatches = pageContent.match(/Recent Income[\s\S]*?(?=##|$)/i);
    let totalIncome = 0;
    if (incomeMatches) {
      const amounts = incomeMatches[0].match(/£([\d,]+\.?\d*)/g);
      if (amounts) {
        totalIncome = amounts.reduce((sum, amt) => sum + parseFloat(amt.replace('£', '').replace(',', '')), 0);
      }
    }
    
    // Parse expense entries
    const expenseMatches = pageContent.match(/Recent Expenses[\s\S]*?(?=##|$)/i);
    let totalExpenses = 0;
    if (expenseMatches) {
      const amounts = expenseMatches[0].match(/£([\d,]+\.?\d*)/g);
      if (amounts) {
        totalExpenses = amounts.reduce((sum, amt) => sum + parseFloat(amt.replace('£', '').replace(',', '')), 0);
      }
    }
    
    const netProfit = totalIncome - totalExpenses;
    const today = new Date().toISOString().split('T')[0] + ' ' + new Date().toTimeString().slice(0, 5);
    
    // Find and update the Financial Summary block
    const blocks = await notion.blocks.children.list({
      block_id: ACCOUNTS_PAGE_ID,
      page_size: 100
    });
    
    for (const block of blocks.results as any[]) {
      if (block.type === 'paragraph') {
        const text = block.paragraph?.rich_text?.[0]?.plain_text || '';
        if (text.includes('Total Income:')) {
          await notion.blocks.update({
            block_id: block.id,
            paragraph: {
              rich_text: [{ type: 'text', text: { content: `Total Income: £${totalIncome.toFixed(2)}` } }]
            }
          });
        } else if (text.includes('Total Expenses:')) {
          await notion.blocks.update({
            block_id: block.id,
            paragraph: {
              rich_text: [{ type: 'text', text: { content: `Total Expenses: £${totalExpenses.toFixed(2)}` } }]
            }
          });
        } else if (text.includes('Net Profit:')) {
          await notion.blocks.update({
            block_id: block.id,
            paragraph: {
              rich_text: [{ type: 'text', text: { content: `Net Profit: £${netProfit.toFixed(2)}` } }]
            }
          });
        } else if (text.includes('Last Updated:')) {
          await notion.blocks.update({
            block_id: block.id,
            paragraph: {
              rich_text: [{ type: 'text', text: { content: `Last Updated: ${today}` } }]
            }
          });
        }
      }
    }
  } catch (error) {
    console.error('Update totals error:', error);
  }
}

// Get AI tools spending (credits + subscriptions) from the AI Tools section
export async function getAIToolsSpending(): Promise<{
  tools: { name: string; subscription: number; billingDay: number; credits: { amount: number; date: string }[] }[];
  summary: { totalSubscriptions: number; avgMonthlyCredits: number; estimatedTotal: number };
  currentMonthCredits: { [tool: string]: number };
}> {
  try {
    const pageContent = await getPageContent(ACCOUNTS_PAGE_ID);
    const tools: { name: string; subscription: number; billingDay: number; credits: { amount: number; date: string }[] }[] = [];
    
    // Find the AI Tools section
    const aiSection = pageContent.match(/AI Tools[\s\S]*?(?=##\s+(?!AI)|My Subscriptions|Recurring Subscriptions|$)/i);
    if (!aiSection) {
      return { tools: [], summary: { totalSubscriptions: 0, avgMonthlyCredits: 0, estimatedTotal: 0 }, currentMonthCredits: {} };
    }
    
    const sectionContent = aiSection[0];
    
    // Parse tool entries - look for patterns like "Replit - £25/month (billing day 15)"
    // And credit entries like "£50 - 2026-01-15"
    const lines = sectionContent.split('\n');
    let currentTool: { name: string; subscription: number; billingDay: number; credits: { amount: number; date: string }[] } | null = null;
    
    for (const line of lines) {
      // Check for tool header: "Replit - £25/month" or "OpenAI - £20/month (billing day 1)"
      const toolMatch = line.match(/^[-•\s]*(\w+(?:\s+\w+)?)\s*[-–]\s*£([\d.]+)\/month(?:\s*\(billing day\s*(\d+)\))?/i);
      if (toolMatch) {
        if (currentTool) {
          tools.push(currentTool);
        }
        currentTool = {
          name: toolMatch[1].trim(),
          subscription: parseFloat(toolMatch[2]),
          billingDay: toolMatch[3] ? parseInt(toolMatch[3]) : 1,
          credits: []
        };
        continue;
      }
      
      // Check for credit entry: "£50 - 2026-01-15" or "2026-01-15: £50"
      if (currentTool) {
        const creditMatch = line.match(/£([\d.]+)\s*[-–]\s*(\d{4}-\d{2}-\d{2})|(\d{4}-\d{2}-\d{2})[:]\s*£([\d.]+)/);
        if (creditMatch) {
          const amount = parseFloat(creditMatch[1] || creditMatch[4]);
          const date = creditMatch[2] || creditMatch[3];
          currentTool.credits.push({ amount, date });
        }
      }
    }
    
    if (currentTool) {
      tools.push(currentTool);
    }
    
    // Calculate summary
    const totalSubscriptions = tools.reduce((sum, t) => sum + t.subscription, 0);
    
    // Calculate average monthly credits (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    let totalCredits = 0;
    const monthsWithCredits = new Set<string>();
    
    for (const tool of tools) {
      for (const credit of tool.credits) {
        const creditDate = new Date(credit.date);
        if (creditDate >= sixMonthsAgo) {
          totalCredits += credit.amount;
          monthsWithCredits.add(`${creditDate.getFullYear()}-${creditDate.getMonth()}`);
        }
      }
    }
    
    const monthCount = Math.max(monthsWithCredits.size, 1);
    const avgMonthlyCredits = totalCredits / monthCount;
    
    // Calculate current month credits per tool
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const currentMonthCredits: { [tool: string]: number } = {};
    
    for (const tool of tools) {
      let monthTotal = 0;
      for (const credit of tool.credits) {
        const creditDate = new Date(credit.date);
        if (creditDate.getMonth() === currentMonth && creditDate.getFullYear() === currentYear) {
          monthTotal += credit.amount;
        }
      }
      if (monthTotal > 0) {
        currentMonthCredits[tool.name] = monthTotal;
      }
    }
    
    return {
      tools,
      summary: {
        totalSubscriptions,
        avgMonthlyCredits: Math.round(avgMonthlyCredits * 100) / 100,
        estimatedTotal: Math.round((totalSubscriptions + avgMonthlyCredits) * 100) / 100
      },
      currentMonthCredits
    };
  } catch (error) {
    console.error('Get AI tools spending error:', error);
    return { tools: [], summary: { totalSubscriptions: 0, avgMonthlyCredits: 0, estimatedTotal: 0 }, currentMonthCredits: {} };
  }
}

// Add a credit purchase to an AI tool
export async function addAICredit(toolName: string, amount: number, date?: string): Promise<{ success: boolean; message: string }> {
  try {
    const notion = await getNotionClient();
    const creditDate = date || new Date().toISOString().split('T')[0];
    const creditText = `£${amount.toFixed(2)} - ${creditDate}`;
    
    // Find the AI Tools section and the specific tool
    const blocks = await notion.blocks.children.list({
      block_id: ACCOUNTS_PAGE_ID,
      page_size: 100
    });
    
    let aiToolsBlockId: string | null = null;
    let toolBlockId: string | null = null;
    
    for (const block of blocks.results as any[]) {
      const text = extractTextFromBlock(block).toLowerCase();
      if (text.includes('ai tools')) {
        aiToolsBlockId = block.id;
      }
      if (text.toLowerCase().includes(toolName.toLowerCase()) && text.includes('/month')) {
        toolBlockId = block.id;
        break;
      }
    }
    
    if (!toolBlockId && !aiToolsBlockId) {
      return { success: false, message: `Couldn't find ${toolName} in AI Tools section` };
    }
    
    const targetBlock = toolBlockId || aiToolsBlockId || ACCOUNTS_PAGE_ID;
    
    await notion.blocks.children.append({
      block_id: targetBlock,
      children: [{
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: [{ type: 'text', text: { content: creditText } }]
        }
      }]
    });
    
    return { success: true, message: `Added £${amount.toFixed(2)} credit purchase to ${toolName}` };
  } catch (error) {
    console.error('Add AI credit error:', error);
    return { success: false, message: 'Failed to add credit purchase' };
  }
}

// Get subscriptions for reminder purposes
export async function getSubscriptions(): Promise<{ name: string; amount: string; dueDate: string; frequency: string }[]> {
  try {
    const pageContent = await getPageContent(ACCOUNTS_PAGE_ID);
    const subscriptions: { name: string; amount: string; dueDate: string; frequency: string }[] = [];
    
    // Find the Recurring Subscriptions section
    const subSection = pageContent.match(/Recurring Subscriptions[\s\S]*?(?=##|$)/i);
    if (subSection) {
      // Parse each subscription line: "Name - £XX.XX (frequency) - Due: X"
      const lines = subSection[0].split('\n').filter(l => l.includes('£'));
      for (const line of lines) {
        const match = line.match(/(.+?)\s*-\s*£([\d,.]+)\s*\((\w+)\)\s*-\s*Due:\s*(.+?)(?:\s*\[|$)/);
        if (match) {
          subscriptions.push({
            name: match[1].replace(/^-\s*/, '').trim(),
            amount: match[2],
            frequency: match[3],
            dueDate: match[4].trim()
          });
        }
      }
    }
    
    return subscriptions;
  } catch (error) {
    console.error('Get subscriptions error:', error);
    return [];
  }
}

// Document collaboration functions

export async function listRecentPages(limit: number = 10): Promise<{ title: string; id: string; url: string; lastEdited: string; type: string }[]> {
  try {
    const notion = await getNotionClient();
    
    // Search for both pages and databases
    const [pagesResponse, dbResponse] = await Promise.all([
      notion.search({
        filter: { property: 'object', value: 'page' },
        sort: { direction: 'descending', timestamp: 'last_edited_time' },
        page_size: limit
      }),
      notion.search({
        filter: { property: 'object', value: 'database' },
        sort: { direction: 'descending', timestamp: 'last_edited_time' },
        page_size: limit
      })
    ]);

    const extractTitle = (item: any): string => {
      // For databases, title is in item.title array
      if (item.object === 'database' && item.title) {
        return item.title[0]?.plain_text || 'Untitled Database';
      }
      // For pages, title is in properties
      return item.properties?.title?.title?.[0]?.plain_text 
        || item.properties?.Name?.title?.[0]?.plain_text
        || item.properties?.Title?.title?.[0]?.plain_text
        || 'Untitled';
    };

    const pages = pagesResponse.results.map((page: any) => ({
      title: extractTitle(page),
      id: page.id,
      url: page.url,
      lastEdited: page.last_edited_time,
      type: 'page'
    }));

    const databases = dbResponse.results.map((db: any) => ({
      title: extractTitle(db),
      id: db.id,
      url: db.url,
      lastEdited: db.last_edited_time,
      type: 'database'
    }));

    // Combine and sort by last edited
    const all = [...pages, ...databases].sort((a, b) => 
      new Date(b.lastEdited).getTime() - new Date(a.lastEdited).getTime()
    );

    return all.slice(0, limit);
  } catch (error) {
    console.error('Notion list recent pages error:', error);
    throw error;
  }
}

export async function appendToPage(pageId: string, content: string): Promise<{ success: boolean; message: string }> {
  try {
    const notion = await getNotionClient();
    
    const blocks = contentToBlocks(content);
    
    await notion.blocks.children.append({
      block_id: pageId,
      children: blocks
    });
    
    return { success: true, message: 'Content added to page' };
  } catch (error: any) {
    console.error('Notion append error:', error);
    return { success: false, message: error.message || 'Failed to add content' };
  }
}

export async function createPage(parentPageId: string, title: string, content?: string): Promise<{ success: boolean; pageId?: string; url?: string; message: string }> {
  try {
    const notion = await getNotionClient();
    
    const children = content ? contentToBlocks(content) : [];
    
    const response = await notion.pages.create({
      parent: { page_id: parentPageId },
      properties: {
        title: {
          title: [{ text: { content: title } }]
        }
      },
      children
    });
    
    return {
      success: true,
      pageId: response.id,
      url: (response as any).url,
      message: `Created page: ${title}`
    };
  } catch (error: any) {
    console.error('Notion create page error:', error);
    return { success: false, message: error.message || 'Failed to create page' };
  }
}

function contentToBlocks(content: string): any[] {
  const lines = content.split('\n');
  const blocks: any[] = [];
  
  for (const line of lines) {
    if (!line.trim()) continue;
    
    if (line.startsWith('# ')) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: { rich_text: [{ type: 'text', text: { content: line.slice(2) } }] }
      });
    } else if (line.startsWith('## ')) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: { rich_text: [{ type: 'text', text: { content: line.slice(3) } }] }
      });
    } else if (line.startsWith('### ')) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: { rich_text: [{ type: 'text', text: { content: line.slice(4) } }] }
      });
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: [{ type: 'text', text: { content: line.slice(2) } }] }
      });
    } else if (line.match(/^\d+\.\s/)) {
      blocks.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: { rich_text: [{ type: 'text', text: { content: line.replace(/^\d+\.\s/, '') } }] }
      });
    } else if (line.startsWith('[ ] ') || line.startsWith('[x] ')) {
      blocks.push({
        object: 'block',
        type: 'to_do',
        to_do: { 
          rich_text: [{ type: 'text', text: { content: line.slice(4) } }],
          checked: line.startsWith('[x] ')
        }
      });
    } else {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: line } }] }
      });
    }
  }
  
  return blocks;
}

export async function getPageByName(name: string): Promise<{ id: string; title: string; content: string; url: string } | null> {
  try {
    const pages = await searchNotionPages(name);
    if (pages.length === 0) return null;
    
    const page = pages[0];
    const content = await getPageContent(page.id);
    
    return {
      id: page.id,
      title: page.title,
      content,
      url: page.url
    };
  } catch (error) {
    console.error('Get page by name error:', error);
    return null;
  }
}

export function formatDocumentContent(title: string, content: string): string {
  return `## ${title}\n\n${content || '(Empty page)'}`;
}
