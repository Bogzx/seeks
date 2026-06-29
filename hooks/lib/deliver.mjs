// Autonomous L3 delivery: push seeks/<name> + open an idempotent PR, degrading
// pr → push → local when gh/remote are absent. Never throws — every step downgrades.
import { execFileSync } from 'node:child_process';
export function isGithubRemote(url){ return /github\.com[:/]/i.test(String(url || '')); }
export function deliveryMode({ hasRemote, isGithub, hasGh }){
  if (hasRemote && isGithub && hasGh) return 'pr';
  if (hasRemote) return 'push';
  return 'local';
}
const tryGit = (root, ...args) => { try { return { ok:true, out: execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim() }; } catch { return { ok:false, out:'' }; } };
const hasCmd = (cmd) => { try { execFileSync(cmd,['--version'],{stdio:'ignore'}); return true; } catch { return false; } };
export function deliver(name, ctx = {}){
  const root = ctx.root; const branch = ctx.branch || `seeks/${name}`; const base = ctx.base_ref || 'HEAD';
  const remote = tryGit(root,'remote','get-url','origin');
  const hasRemote = remote.ok && !!remote.out;
  let mode = deliveryMode({ hasRemote, isGithub: hasRemote && isGithubRemote(remote.out), hasGh: hasCmd('gh') });
  let pr_url = null, note = '';
  if (mode === 'pr' || mode === 'push'){
    if (!tryGit(root,'push','-u','origin',branch).ok){ mode = 'local'; note = 'push failed — branch kept local'; }
  }
  if (mode === 'pr'){
    let url = '';
    try { url = JSON.parse(execFileSync('gh',['pr','view',branch,'--json','url'],{cwd:root,encoding:'utf8'})).url; } catch {}
    if (!url){
      try { url = execFileSync('gh',['pr','create','--base',base,'--head',branch,'--title',ctx.title||`seeks: ${name}`,'--body',ctx.body||'Automated by seeks. Review the diff; the merge is yours.'],{cwd:root,encoding:'utf8'}).trim(); }
      catch { mode = 'push'; note = 'gh pr create failed (auth?) — branch pushed, open the PR manually'; }
    }
    if (url) pr_url = url;
  }
  if (!note) note = mode === 'pr' ? `PR ${pr_url}` : mode === 'push' ? 'pushed (no gh/PR — open manually)' : 'no remote — branch kept local';
  return { mode, pr_url, note };
}
