const providerKeys={openai:'OPENAI_API_KEY',claude:'ANTHROPIC_API_KEY',gemini:'GEMINI_API_KEY',qwen:'QWEN_API_KEY'};
function unavailable(message,status=503){throw Object.assign(new Error(message),{status});}
export function providers(env){return ['qwen','openai','claude','gemini'].map(id=>({id,model:env[id.toUpperCase()+'_MODEL']||'',ready:id==='qwen'?!!env.QWEN_MODEL&&(env.LOCAL_MODE==='true'||!!(env.QWEN_BASE_URL&&env.QWEN_API_KEY)):!!env[providerKeys[id]]&&!!env[id.toUpperCase()+'_MODEL']}));}
export function sharedSettings(env,provider){const config=providers(env).find(p=>p.id===provider);if(!config?.ready)unavailable('此 AI 服務尚未由網站管理者啟用，請稍後再試。');let endpoint;
 if(provider==='qwen'){if(env.LOCAL_MODE==='true')endpoint='http://127.0.0.1:11434/v1/chat/completions';else {let u;try{u=new URL(env.QWEN_BASE_URL);}catch{unavailable('共用 Qwen 連線尚未設定完成。');}if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[)/i.test(u.hostname))unavailable('共用 Qwen 連線設定不正確。');endpoint=u.href.replace(/\/$/,'')+'/chat/completions';}}
 return {model:config.model,key:env[providerKeys[provider]]||'',endpoint};}
export function identity(request,env){if(env.LOCAL_MODE==='true')return 'local-owner';return request.headers.get('oai-authenticated-user-id')&&request.headers.get('oai-authenticated-user-email')?request.headers.get('oai-authenticated-user-id'):null;}
export function requireIdentity(request,env){const id=identity(request,env);if(!id)unavailable('請先使用 ChatGPT 登入，再使用查詢或分析。',401);return id;}
