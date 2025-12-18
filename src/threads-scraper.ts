import axios from 'axios';

const BASE_API_URL = 'https://www.threads.net/api/graphql';

// Extract embedded media URL from Threads post (Instagram, YouTube, etc.)
export async function extractThreadsEmbeddedUrl(url: string): Promise<string | null> {
  try {
    // Use embed endpoint which contains the links
    const embedUrl = url.replace(/\?.*$/, '') + '/embed';

    const response = await axios.get(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15',
        'Accept': 'text/html,application/xhtml+xml',
      },
      timeout: 15000,
      maxRedirects: 5,
    });

    const html = response.data;

    // Look for Facebook redirect links (most common for shared content)
    const fbRedirectMatch = html.match(/l\.facebook\.com\/l\.php\?u=([^&"]+)/);
    if (fbRedirectMatch) {
      const decodedUrl = decodeURIComponent(fbRedirectMatch[1]);
      // Check if it's a supported platform
      if (decodedUrl.includes('instagram.com') ||
          decodedUrl.includes('youtube.com') ||
          decodedUrl.includes('youtu.be') ||
          decodedUrl.includes('tiktok.com')) {
        return decodedUrl;
      }
    }

    // Look for direct Instagram reel/post links
    const igReelMatch = html.match(/https:\/\/(?:www\.)?instagram\.com\/(?:reel|p)\/[A-Za-z0-9_-]+/);
    if (igReelMatch) {
      return igReelMatch[0];
    }

    // Look for YouTube links
    const ytMatch = html.match(/https:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[A-Za-z0-9_-]+/);
    if (ytMatch) {
      return ytMatch[0];
    }

    // Look for TikTok links
    const ttMatch = html.match(/https:\/\/(?:www\.)?tiktok\.com\/@[^\/]+\/video\/\d+/);
    if (ttMatch) {
      return ttMatch[0];
    }

    // Look for native Threads video (in source tag)
    const nativeVideoMatch = html.match(/src="(https:\/\/[^"]+\.mp4[^"]*)"/);
    if (nativeVideoMatch) {
      // Decode HTML entities
      const videoUrl = nativeVideoMatch[1]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"');
      return `NATIVE_VIDEO:${videoUrl}`;
    }

    return null;
  } catch {
    return null;
  }
}

// Convert shortcode to post ID
function getPostId(url: string): string | null {
  try {
    url = url.split('?')[0].replace(/\/+$/, '');
    const shortcode = url.split('/').pop();
    if (!shortcode) return null;

    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let postID = 0n;
    for (const letter of shortcode) {
      postID = postID * 64n + BigInt(alphabet.indexOf(letter));
    }
    return postID.toString();
  } catch {
    return null;
  }
}

// Fetch post data from Threads API
async function getPostData(postId: string): Promise<any> {
  const headers = {
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'content-type': 'application/x-www-form-urlencoded',
    'origin': 'https://www.threads.net',
    'referer': 'https://www.threads.net/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'x-asbd-id': '129477',
    'x-fb-friendly-name': 'BarcelonaPostPageQuery',
    'x-ig-app-id': '238260118697367',
  };

  // Try multiple LSD tokens (updated from live page)
  const lsdTokens = [
    'AdG81DnT7rk',
    'AVqbxe3J_YA',
    'AVp1gF_TM2Q',
  ];

  for (const lsd of lsdTokens) {
    try {
      const data = new URLSearchParams({
        'av': '0',
        '__user': '0',
        '__a': '1',
        '__req': '1',
        'dpr': '1',
        '__ccg': 'EXCELLENT',
        'lsd': lsd,
        'jazoest': '21774',
        'fb_api_caller_class': 'RelayModern',
        'fb_api_req_friendly_name': 'BarcelonaPostPageQuery',
        'variables': JSON.stringify({ postID: postId }),
        'server_timestamps': 'true',
        'doc_id': '5587632691339264',
      });

      const response = await axios.post(BASE_API_URL, data.toString(), {
        headers: { ...headers, 'x-fb-lsd': lsd },
        timeout: 15000,
      });

      if (response.data?.data?.data) {
        return response.data.data.data;
      }
    } catch {
      continue;
    }
  }
  return null;
}

// Extract media from thread data
function extractMedia(thread: any): any {
  let media = thread.post;

  // Handle quoted/reposted posts
  if (media.text_post_app_info?.share_info?.quoted_post) {
    const quoted = media.text_post_app_info.share_info.quoted_post;
    if (quoted.video_versions || quoted.image_versions2) {
      media = quoted;
    }
  }
  if (media.text_post_app_info?.share_info?.reposted_post) {
    const reposted = media.text_post_app_info.share_info.reposted_post;
    if (reposted.video_versions || reposted.image_versions2) {
      media = reposted;
    }
  }

  // Handle carousel media
  if (media.carousel_media?.length > 0) {
    const videos = media.carousel_media.filter((m: any) => m.video_versions?.length > 0);
    if (videos.length > 0) {
      return {
        type: 'videos',
        items: videos.map((v: any) => ({
          url: v.video_versions[0].url,
          width: v.original_width,
          height: v.original_height,
          thumbnail: v.image_versions2?.candidates?.[0]?.url,
        })),
        caption: media.caption?.text || '',
      };
    }
    return {
      type: 'photos',
      items: media.carousel_media.map((p: any) => ({
        url: p.image_versions2?.candidates?.[0]?.url,
        width: p.original_width,
        height: p.original_height,
      })),
      caption: media.caption?.text || '',
    };
  }

  // Handle single video
  if (media.video_versions?.length > 0) {
    return {
      type: 'video',
      url: media.video_versions[0].url,
      width: media.original_width,
      height: media.original_height,
      thumbnail: media.image_versions2?.candidates?.[0]?.url,
      caption: media.caption?.text || '',
      has_audio: media.has_audio,
    };
  }

  // Handle single photo
  if (media.image_versions2?.candidates?.length > 0) {
    return {
      type: 'photo',
      url: media.image_versions2.candidates[0].url,
      width: media.original_width,
      height: media.original_height,
      caption: media.caption?.text || '',
    };
  }

  return null;
}

export interface ThreadsMediaResult {
  success: boolean;
  error?: string;
  data?: {
    type: 'video' | 'photo' | 'videos' | 'photos';
    url?: string;
    items?: Array<{ url: string; width: number; height: number; thumbnail?: string }>;
    width?: number;
    height?: number;
    thumbnail?: string;
    caption?: string;
    username?: string;
  };
}

export async function getThreadsMedia(url: string): Promise<ThreadsMediaResult> {
  try {
    // Validate URL
    if (!url.includes('threads.net') && !url.includes('threads.com')) {
      return { success: false, error: 'Invalid Threads URL' };
    }

    const postId = getPostId(url);
    if (!postId) {
      return { success: false, error: 'Could not extract post ID from URL' };
    }

    const postData = await getPostData(postId);
    if (!postData) {
      return { success: false, error: 'Could not fetch post data - post may be private or deleted' };
    }

    const threads = postData.containing_thread?.thread_items;
    if (!threads?.length) {
      return { success: false, error: 'No media found in post' };
    }

    const username = threads[0]?.post?.user?.username;
    const mediaData = extractMedia(threads[0]);

    if (!mediaData) {
      return { success: false, error: 'No downloadable media found' };
    }

    return {
      success: true,
      data: {
        ...mediaData,
        username,
      },
    };
  } catch (error: any) {
    return { success: false, error: error.message || 'Unknown error' };
  }
}

// Get video info for API response
export async function getThreadsVideoInfo(url: string) {
  const result = await getThreadsMedia(url);
  if (!result.success || !result.data) {
    return { error: result.error || 'Could not get video info' };
  }

  return {
    title: result.data.caption?.substring(0, 100) || `Threads post by @${result.data.username}`,
    duration: 'Unknown',
    uploader: result.data.username || 'Unknown',
    thumbnail: result.data.thumbnail || result.data.url,
    type: result.data.type,
  };
}
