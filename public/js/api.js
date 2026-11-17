export async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'dibs' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    const e = new Error("Can't reach the server. Check your connection.");
    e.offline = true;
    throw e;
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const e = new Error(data?.error || 'Something went wrong.');
    e.status = res.status;
    e.data = data;
    throw e;
  }
  return data;
}
