/** Same-origin Quantum gateway only. No password form, embedded key or invented
 * /auth/login endpoint. Existing organization identity is checked server-side. */
import type { Actor, HubData } from './types';
export async function request<T>(path:string, body?:unknown, method=body===undefined?'GET':'POST'):Promise<T> {
  const res=await fetch('/api/singularity'+path,{
    method, credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000),
    headers:{Accept:'application/json',...(body!==undefined?{'Content-Type':'application/json'}:{})},
    ...(body!==undefined?{body:JSON.stringify(body)}:{}),
  });
  if (!res.ok) throw new Error(res.status===401?'Sign in through the existing Quantum / DSECT identity gateway.':`Singularity request failed (${res.status}). Your draft has been kept.`);
  return await res.json() as T;
}
export const hubSession=()=>request<{actor:Actor;demo:boolean}>('/session');
export const hubSnapshot=()=>request<HubData & {demo:boolean;deliveries:Array<{id:string;kind:string;status:string}>}>('/snapshot');
