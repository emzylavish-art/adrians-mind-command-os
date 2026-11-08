import {
  getAccessToken,
  getRefreshToken,
  storeAccessToken,
} from "@/lib/mind/connectors/store";
import { getProvider } from "@/lib/mind/connectors/providers";

type JsonRecord = Record<string, unknown>;

async function refreshYoutubeToken(ownerId: string): Promise<string | null> {
  const refreshToken = getRefreshToken(ownerId, "youtube");
  const env = getProvider("youtube").readEnv();
  if (!refreshToken || !env.clientId || !env.clientSecret || !env.tokenUrl) return null;
  const body = new URLSearchParams({
    client_id: env.clientId,
    client_secret: env.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const response = await fetch(env.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  if (!response.ok) return null;
  const json = (await response.json().catch(() => null)) as JsonRecord | null;
  if (!json || typeof json.access_token !== "string") return null;
  storeAccessToken({
    ownerId,
    connector: "youtube",
    accessToken: json.access_token,
    refreshToken,
    tokenType: typeof json.token_type === "string" ? json.token_type : "Bearer",
    scopes: typeof json.scope === "string" ? json.scope : undefined,
  });
  return json.access_token;
}

export async function youtubeFetch(ownerId: string, url: string): Promise<Response> {
  let token = getAccessToken(ownerId, "youtube");
  if (!token) throw new Error("YouTube is not connected. Connect your channel first.");
  let response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (response.status === 401) {
    token = await refreshYoutubeToken(ownerId);
    if (!token) throw new Error("YouTube authorization expired. Reconnect your channel.");
    response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  }
  if (!response.ok) {
    throw new Error(`YouTube API request failed (${response.status}). Check API access and channel permissions.`);
  }
  return response;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function getYoutubeOverview(ownerId: string, days = 28) {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 2);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - Math.max(7, Math.min(365, days)) + 1);
  const base = "https://www.googleapis.com/youtube/v3";
  const channelUrl = new URL(`${base}/channels`);
  channelUrl.searchParams.set("part", "snippet,statistics,contentDetails");
  channelUrl.searchParams.set("mine", "true");
  const channelResponse = await youtubeFetch(ownerId, channelUrl.toString());
  const channelJson = (await channelResponse.json()) as { items?: JsonRecord[] };
  const channel = channelJson.items?.[0];
  if (!channel) throw new Error("No YouTube channel was found for the authorized Google account.");
  const snippet = (channel.snippet || {}) as JsonRecord;
  const statistics = (channel.statistics || {}) as JsonRecord;

  const analyticsUrl = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
  analyticsUrl.searchParams.set("ids", "channel==MINE");
  analyticsUrl.searchParams.set("startDate", isoDate(start));
  analyticsUrl.searchParams.set("endDate", isoDate(end));
  analyticsUrl.searchParams.set("metrics", "views,estimatedMinutesWatched,subscribersGained,subscribersLost,averageViewDuration,likes,comments,shares");
  analyticsUrl.searchParams.set("dimensions", "day");
  analyticsUrl.searchParams.set("sort", "day");
  const analyticsResponse = await youtubeFetch(ownerId, analyticsUrl.toString());
  const analytics = (await analyticsResponse.json()) as { columnHeaders?: Array<{ name: string }>; rows?: unknown[][] };

  const topUrl = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
  topUrl.searchParams.set("ids", "channel==MINE");
  topUrl.searchParams.set("startDate", isoDate(start));
  topUrl.searchParams.set("endDate", isoDate(end));
  topUrl.searchParams.set("metrics", "views,estimatedMinutesWatched,averageViewDuration");
  topUrl.searchParams.set("dimensions", "video");
  topUrl.searchParams.set("sort", "-views");
  topUrl.searchParams.set("maxResults", "10");
  const topResponse = await youtubeFetch(ownerId, topUrl.toString());
  const top = (await topResponse.json()) as { columnHeaders?: Array<{ name: string }>; rows?: unknown[][] };
  const ids = (top.rows || []).map(row => String(row[0] || "")).filter(Boolean);
  let videoItems: JsonRecord[] = [];
  if (ids.length) {
    const videosUrl = new URL(`${base}/videos`);
    videosUrl.searchParams.set("part", "snippet,statistics,contentDetails,status");
    videosUrl.searchParams.set("id", ids.join(","));
    const videosResponse = await youtubeFetch(ownerId, videosUrl.toString());
    const videosJson = (await videosResponse.json()) as { items?: JsonRecord[] };
    videoItems = videosJson.items || [];
  }

  let revenue: number | null = null;
  try {
    const revenueUrl = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
    revenueUrl.searchParams.set("ids", "channel==MINE");
    revenueUrl.searchParams.set("startDate", isoDate(start));
    revenueUrl.searchParams.set("endDate", isoDate(end));
    revenueUrl.searchParams.set("metrics", "estimatedRevenue");
    const revenueResponse = await youtubeFetch(ownerId, revenueUrl.toString());
    const revenueJson = (await revenueResponse.json()) as { rows?: unknown[][] };
    const raw = revenueJson.rows?.[0]?.[0];
    revenue = typeof raw === "number" ? raw : raw == null ? null : Number(raw);
    if (!Number.isFinite(revenue)) revenue = null;
  } catch {
    revenue = null;
  }

  return {
    connected: true,
    channel: {
      id: channel.id,
      title: typeof snippet.title === "string" ? snippet.title : "YouTube channel",
      description: typeof snippet.description === "string" ? snippet.description : "",
      thumbnail: ((snippet.thumbnails || {}) as JsonRecord).high
        ? (((((snippet.thumbnails || {}) as JsonRecord).high || {}) as JsonRecord).url as string | undefined)
        : undefined,
      country: typeof snippet.country === "string" ? snippet.country : undefined,
      subscribers: Number(statistics.subscriberCount || 0),
      views: Number(statistics.viewCount || 0),
      videoCount: Number(statistics.videoCount || 0),
      hiddenSubscriberCount: Boolean(statistics.hiddenSubscriberCount),
    },
    period: { startDate: isoDate(start), endDate: isoDate(end), days },
    analytics: {
      columns: (analytics.columnHeaders || []).map(column => column.name),
      rows: analytics.rows || [],
    },
    topVideos: videoItems.map(video => {
      const videoSnippet = (video.snippet || {}) as JsonRecord;
      const videoStats = (video.statistics || {}) as JsonRecord;
      const thumbs = (videoSnippet.thumbnails || {}) as JsonRecord;
      const thumb = (thumbs.medium || thumbs.default || {}) as JsonRecord;
      return {
        id: video.id,
        title: videoSnippet.title,
        publishedAt: videoSnippet.publishedAt,
        thumbnail: thumb.url,
        views: Number(videoStats.viewCount || 0),
        likes: Number(videoStats.likeCount || 0),
        comments: Number(videoStats.commentCount || 0),
      };
    }),
    revenue,
    revenueAvailable: revenue !== null,
    source: "youtube-api",
    fetchedAt: new Date().toISOString(),
  };
}
