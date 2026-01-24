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

export async function findGrindTracker(): Promise<{ content: string; url: string } | null> {
  try {
    const pages = await searchNotionPages('grind tracker');
    
    if (pages.length === 0) {
      return null;
    }

    const tracker = pages[0];
    const content = await getPageContent(tracker.id);
    
    return {
      content,
      url: tracker.url
    };
  } catch (error) {
    console.error('Error finding grind tracker:', error);
    return null;
  }
}
