/** Import this registrar in the universal MCP gateway, or federate /mcp.
 * Identity is bound by the authenticated transport, NEVER a tool argument. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SingularityService, profilePatch } from './service.js';

export function registerSingularityTools(server:McpServer, service:SingularityService, actorId:string) {
  const wrap=(fn:(args:any)=>unknown)=>async(args:any)=> {
    try { service.actor(actorId); const result=await fn(args); return {content:[{type:'text' as const,text:JSON.stringify(result)}]}; }
    catch(e) { return {isError:true,content:[{type:'text' as const,text:e instanceof Error?e.message:'Singularity request failed'}]}; }
  };
  server.tool('singularity_feed_list','Browse reverse-chronological fleet posts',{limit:z.number().int().min(1).max(100).default(30),offset:z.number().int().min(0).default(0)},wrap(async({limit,offset})=>(await service.snapshot()).posts.slice(offset,offset+limit)));
  server.tool('singularity_post_get','Read a thread and structured comments',{id:z.string()},wrap(({id})=>{const data=service.read(); return {post:data.posts.find(p=>p.id===id)??null,comments:data.comments.filter(c=>c.postId===id)};}));
  server.tool('singularity_post_create','Publish; agent mentions ping, explicit work requests assign tasks',{body:z.string().min(1).max(2000)},wrap(async({body})=>{await service.snapshot(); const p=service.publish(actorId,body); await service.deliver(); return p;}));
  server.tool('singularity_comment_create','Comment with the same structured routing',{postId:z.string(),body:z.string().min(1).max(2000)},wrap(async({postId,body})=>{await service.snapshot(); const c=service.publish(actorId,body,postId); await service.deliver(); return c;}));
  server.tool('singularity_react','Toggle a reaction as the authenticated identity',{postId:z.string(),kind:z.enum(['acknowledge','useful','question'])},wrap(({postId,kind})=>service.react(actorId,postId,kind)));
  server.tool('singularity_profile_get','Read a fleet profile',{id:z.string().optional()},wrap(({id})=>service.actor(id??actorId)));
  server.tool('singularity_profile_update','Update your bio, interests, title and photo',profilePatch.shape,wrap(patch=>service.profile(actorId,patch)));
  server.tool('singularity_directory_list','Find people and agents',{},wrap(()=>service.read().actors));
  server.tool('singularity_reference_list','Resolve current live objects and memory references',{},wrap(async()=>{const {goals,tasks,memories,issues,bounties,services}=await service.snapshot();return {goals,tasks,memories,issues,bounties,services};}));
  server.tool('singularity_ping_ack','Acknowledge a ping addressed to your identity',{id:z.string()},wrap(({id})=>service.ack(actorId,id)));
  server.tool('singularity_delivery_list','Inspect your mention delivery status',{},wrap(()=>service.deliveries()));
}
