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
