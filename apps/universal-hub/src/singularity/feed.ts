import type { Actor, Post } from './types';
export type FeedFilter = 'all' | 'mentions' | 'linked' | 'saved';
/** Search the loaded feed only. Identity/role comes from the directory, not body heuristics. */
export function filterFeed(posts:Post[], actors:Actor[], actorId:string, query:string, filter:FeedFilter, saved:string[]) {
 const me=actors.find(a=>a.id===actorId);
 const q=query.trim().toLocaleLowerCase();
 return posts.filter(post=>{
  if(filter==='mentions'&&!post.tokens.some(t=>t.type==='mention'&&t.handle.toLowerCase()===me?.handle.toLowerCase()))return false;
  if(filter==='linked'&&!post.tokens.some(t=>t.type==='ref'))return false;
  if(filter==='saved'&&!saved.includes(post.id))return false;
  const author=actors.find(a=>a.id===post.authorId);
  return !q || [post.body,author?.name,author?.handle,...post.tokens.filter(t=>t.type!=='text').map(t=>t.handle)].join(' ').toLocaleLowerCase().includes(q);
 });
}
