// Tavily web search client for Nova
// Enables Nova to search the web for current information

interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface TavilyResponse {
  query: string;
  results: TavilySearchResult[];
  answer?: string;
}

export async function searchWeb(query: string, maxResults: number = 5): Promise<TavilyResponse> {
  const apiKey = process.env.TAVILY_API_KEY;
  
  if (!apiKey) {
    throw new Error("TAVILY_API_KEY not configured");
  }

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      api_key: apiKey,
      query: query,
      search_depth: "basic",
      max_results: maxResults,
      include_answer: true,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Tavily search failed: ${error}`);
  }

  const data = await response.json();
  
  return {
    query: data.query || '',
    answer: data.answer,
    results: (data.results || []).map((r: any) => ({
      title: r.title,
      url: r.url,
      content: r.content,
      score: r.score,
    })),
  };
}

export function formatSearchResultsForNova(searchResponse: TavilyResponse): string {
  // Keep it short and conversational - Nova hates walls of text
  let formatted = "";
  
  if (searchResponse.answer) {
    // Just use the quick answer if available - that's usually enough
    formatted = `Web search found: ${searchResponse.answer}`;
    
    // Add one source URL for reference
    if (searchResponse.results.length > 0) {
      formatted += ` (source: ${searchResponse.results[0].url})`;
    }
  } else if (searchResponse.results.length > 0) {
    // No quick answer, summarize top 2 results briefly
    const topResults = searchResponse.results.slice(0, 2);
    formatted = "Web search found: ";
    formatted += topResults.map(r => r.content.slice(0, 100)).join(" | ");
    formatted += ` (source: ${topResults[0].url})`;
  } else {
    formatted = "Web search didn't find anything relevant.";
  }
  
  return formatted;
}
