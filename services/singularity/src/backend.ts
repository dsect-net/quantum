/** Adapter to verified Quantum REST collab paths and existing agent-ping MCP.
 * No duplicate task/notification API. Worker key is server-only. */
import type { Backend } from './service.ts';
import type { Actor, HubData } from '../../../apps/universal-hub/src/singularity/types.ts';

export class QuantumBackend implements Backend {
  constructor(private base:string, private key:string) {
    const u=new URL(base); if (u.protocol!=='https:') throw new Error('Live hub must use HTTPS');
  }
  private async request(path:string, init:RequestInit={}) {
    const res=await fetch(this.base.replace(/\/$/,'')+path, {...init,signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',Authorization:`Bearer ${this.key}`,...init.headers}});
    if (!res.ok) throw new Error(`Quantum backend HTTP ${res.status}`);
    return {body:await res.json() as any, headers:res.headers};
  }
  async refresh(data:HubData, handle:(kind:string,id:string)=>string):Promise<Partial<HubData>> {
    const [{body:goals},{body:board}]=await Promise.all([this.request('/api/collab/goals'),this.request('/api/collab/board')]);
    if (!Array.isArray(goals)||!board.columns) throw new Error('Unexpected collab response');
    const actorId=(value:string|null)=>data.actors.find(a=>a.id===value||a.handle.toLowerCase()===value?.toLowerCase())?.id??value;
    return {
      goals:goals.map(g=>({id:g.id,handle:handle('goal',g.id),title:g.title,status:g.status,progress:Math.min(100,Math.max(0,g.progress*100)),ownerId:actorId(g.owner)??'',summary:g.description??''})),
      tasks:Object.values(board.columns).flat().map((t:any)=>({id:t.id,handle:handle('task',t.id),title:t.title,status:t.status,assigneeId:actorId(t.assignee),goalHandle:t.goalId?handle('goal',t.goalId):'',summary:t.notes??''})),
    };
  }
  async assign(taskId:string, actor:Actor) {
    await this.request(`/api/collab/tasks/${encodeURIComponent(taskId)}`,{method:'PATCH',body:JSON.stringify({assignee:actor.handle.toLowerCase()})});
  }
  async ping(ping:HubData['pings'][number], data:HubData) {
    const target=data.actors.find(a=>a.id===ping.toId); if (!target) throw new Error('Unknown agent');
    const init=await this.request('/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'singularity',version:'0.1.0'}}})});
    const session=init.headers.get('mcp-session-id'); if (!session||init.body.error) throw new Error('MCP handshake failed');
    const headers={'mcp-session-id':session};
    // Initialized is a notification (no id), and may return 202 with no body.
    const notify=await fetch(this.base.replace(/\/$/,'')+'/mcp',{method:'POST',headers:{...headers,'Content-Type':'application/json',Authorization:`Bearer ${this.key}`},signal:AbortSignal.timeout(15000),body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})});
    if (!notify.ok) throw new Error('MCP initialization refused');
    const {body}=await this.request('/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'quantum_agent_ping',arguments:{to:target.handle.toLowerCase(),kind:ping.kind,subject:ping.subject,summary:ping.summary,ref:ping.ref??ping.postId}}})});
    if (body.error||body.result?.isError) throw new Error('Agent ping refused');
  }
}
