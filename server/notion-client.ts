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

interface GrindTask {
  title: string;
  status: string;
  progress: number | null;
  daysRemaining: number | null;
  startDate: string | null;
  endDate: string | null;
}

async function queryGrindTrackerDatabase(): Promise<GrindTask[]> {
  try {
    const notion = await getNotionClient();
    
    const response = await notion.databases.query({
      database_id: GRIND_TRACKER_DB_ID,
      page_size: 50
    });

    const tasks: GrindTask[] = [];
    
    for (const page of response.results as any[]) {
      const props = page.properties;
      
      const title = props.Title?.title?.[0]?.plain_text 
        || props.Name?.title?.[0]?.plain_text 
        || 'Untitled';
      
      const status = props.Status?.status?.name 
        || props.Status?.select?.name 
        || '';
      
      const progress = props.Progress?.number ?? null;
      const daysRemaining = props['Days Remaining']?.number ?? null;
      
      const startDate = props['Start Date']?.date?.start || null;
      const endDate = props['End Date']?.date?.start || null;
      
      tasks.push({
        title,
        status,
        progress,
        daysRemaining,
        startDate,
        endDate
      });
    }
    
    return tasks;
  } catch (error) {
    console.error('Error querying grind tracker database:', error);
    throw error;
  }
}

function formatGrindTrackerContent(tasks: GrindTask[]): string {
  if (tasks.length === 0) {
    return 'No tasks in the grind tracker yet.';
  }
  
  let content = '';
  
  for (const task of tasks) {
    if (!task.title || task.title === 'Untitled') continue;
    
    let line = `- ${task.title}`;
    if (task.status) line += ` [${task.status}]`;
    if (task.progress !== null) line += ` (${task.progress}% done)`;
    if (task.daysRemaining !== null) line += ` - ${task.daysRemaining} days left`;
    if (task.endDate) line += ` (due: ${task.endDate})`;
    
    content += line + '\n';
  }
  
  return content.trim() || 'No active tasks found.';
}

export async function findGrindTracker(): Promise<{ content: string; url: string } | null> {
  try {
    const tasks = await queryGrindTrackerDatabase();
    const content = formatGrindTrackerContent(tasks);
    
    return {
      content,
      url: GRIND_TRACKER_URL
    };
  } catch (error) {
    console.error('Error finding grind tracker:', error);
    return null;
  }
}
