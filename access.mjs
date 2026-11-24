function unavailable(message, status = 503) {
  throw Object.assign(new Error(message), { status });
}
export function providers(env) {
  return [
    {
      id: 'qwen',
      model: env.QWEN_MODEL || 'qwen3:4b-instruct',
      ready: env.LOCAL_MODE === 'true',
    },
  ];
}
export function sharedSettings(env, provider) {
  if (provider !== 'qwen') unavailable('本系統僅支援本機 Qwen。', 400);
  const config = providers(env)[0];
  if (!config.ready) unavailable('本機 Qwen 只能透過本機網站使用。');
  return { model: config.model };
}
export function identity(request, env) {
  if (env.LOCAL_MODE === 'true') return 'local-owner';
  return request.headers.get('oai-authenticated-user-id') &&
    request.headers.get('oai-authenticated-user-email')
    ? request.headers.get('oai-authenticated-user-id')
    : null;
}
export function requireIdentity(request, env) {
  const id = identity(request, env);
  if (!id) unavailable('請先使用 ChatGPT 登入，再使用查詢或分析。', 401);
  return id;
}
