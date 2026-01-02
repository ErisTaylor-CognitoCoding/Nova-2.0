// GitHub integration for Nova - using Replit GitHub connection
import { Octokit } from '@octokit/rest';
import { log } from './index';

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
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=github',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings?.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('GitHub not connected');
  }
  return accessToken;
}

async function getGitHubClient() {
  const accessToken = await getAccessToken();
  return new Octokit({ auth: accessToken });
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return new Error(String((error as { message: unknown }).message));
  }
  return new Error('GitHub API error');
}

export async function listRepositories() {
  try {
    const octokit = await getGitHubClient();
    const { data } = await octokit.repos.listForAuthenticatedUser({
      sort: 'updated',
      per_page: 20,
    });
    return data.map(repo => ({
      name: repo.name,
      fullName: repo.full_name,
      description: repo.description,
      url: repo.html_url,
      language: repo.language,
      updatedAt: repo.updated_at,
      isPrivate: repo.private,
    }));
  } catch (error) {
    log(`GitHub list repos error: ${error}`, 'github');
    throw normalizeError(error);
  }
}

export async function getRepositoryContent(owner: string, repo: string, path: string = '') {
  try {
    const octokit = await getGitHubClient();
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path,
    });
    
    if (Array.isArray(data)) {
      return data.map(item => ({
        name: item.name,
        path: item.path,
        type: item.type,
        size: item.size,
      }));
    } else if (data.type === 'file' && 'content' in data) {
      const content = Buffer.from(data.content, 'base64').toString('utf-8');
      return {
        name: data.name,
        path: data.path,
        type: 'file',
        content: content.length > 10000 ? content.substring(0, 10000) + '\n... (truncated)' : content,
      };
    }
    return data;
  } catch (error) {
    log(`GitHub get content error: ${error}`, 'github');
    throw normalizeError(error);
  }
}

export async function searchCode(query: string, owner?: string, repo?: string) {
  try {
    const octokit = await getGitHubClient();
    let searchQuery = query;
    if (owner && repo) {
      searchQuery = `${query} repo:${owner}/${repo}`;
    } else if (owner) {
      searchQuery = `${query} user:${owner}`;
    }
    
    const { data } = await octokit.search.code({
      q: searchQuery,
      per_page: 10,
    });
    
    return data.items.map(item => ({
      name: item.name,
      path: item.path,
      repository: item.repository.full_name,
      url: item.html_url,
    }));
  } catch (error) {
    log(`GitHub search error: ${error}`, 'github');
    throw normalizeError(error);
  }
}

export async function getRecentCommits(owner: string, repo: string, count: number = 10) {
  try {
    const octokit = await getGitHubClient();
    const { data } = await octokit.repos.listCommits({
      owner,
      repo,
      per_page: count,
    });
    
    return data.map(commit => ({
      sha: commit.sha.substring(0, 7),
      message: commit.commit.message,
      author: commit.commit.author?.name,
      date: commit.commit.author?.date,
    }));
  } catch (error) {
    log(`GitHub commits error: ${error}`, 'github');
    throw normalizeError(error);
  }
}
