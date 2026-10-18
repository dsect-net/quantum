/** Universal MCP federation adapter. Register once per authenticated gateway
 * session; provide a worker key bound to THAT principal, not a shared admin key.
 * No changes to the private hub-api repository are implied by this module. */
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {z} from 'zod';
import {profilePatch} from './service.ts';
export async function registerRemoteSingularityTools(gateway:McpServer, endpoint:URL, workerKey:string) {
  if(endpoint.protocol!=='https:') throw new Error('Federated MCP requires HTTPS');
  const client=new Client({name:'quantum-universal-singularity-bridge',version:'0.1.0'});
  await client.connect(new StreamableHTTPClientTransport(endpoint,{requestInit:{headers:{Authorization:`Bearer ${workerKey}`}}}));
  const schemas:Record<string,z.ZodRawShape>={
    singularity_feed_list:{limit:z.number().int().min(1).max(100).default(30),offset:z.number().int().min(0).default(0)},
    singularity_post_get:{id:z.string()},
    singularity_post_create:{body:z.string().min(1).max(2000)},
    singularity_comment_create:{postId:z.string(),body:z.string().min(1).max(2000)},
    singularity_react:{postId:z.string(),kind:z.enum(['acknowledge','useful','question'])},
    singularity_profile_get:{id:z.string().optional()},
    singularity_profile_update:profilePatch.shape,
    singularity_ping_ack:{id:z.string()},singularity_directory_list:{},singularity_reference_list:{},singularity_delivery_list:{},
  };
  try {
    const {tools}=await client.listTools();
    for(const tool of tools) {
      if(!schemas[tool.name]) continue;
      gateway.tool(tool.name,tool.description??tool.name,schemas[tool.name],async args=>{
        try {
          const result=await client.callTool({name:tool.name,arguments:args});
          return {isError:result.isError===true,content:result.content as Array<{type:'text';text:string}>};
        }catch {return {isError:true,content:[{type:'text' as const,text:'Singularity service unavailable'}]};}
      });
    }
  }catch(e){await client.close();throw e;}
  return ()=>client.close();
}
