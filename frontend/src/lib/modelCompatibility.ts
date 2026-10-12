/** Discovery has no portable capability contract. Names are guidance, never proof. */
export function modelCompatibility(id: string): 'text' | 'other' | 'unknown' {
  if (/(embed|whisper|tts|dall-e|moderation|rerank|realtime|transcri|image|audio|music|video|sora)/i.test(id)) return 'other';
  if (/^(gpt-|chatgpt-|o[1-9](?:-|$)|claude-|gemini-|llama|qwen|mistral|deepseek)/i.test(id.replace(/^models\//, ''))) return 'text';
  return 'unknown';
}
