import app from '../server';

export default function handler(req: any, res: any) {
  // If Vercel already consumed the body, mark it so express body-parser does not hang
  if (req.body && typeof req.body === 'object') {
    req._body = true;
  }

  // Restore matched path if rewritten by Vercel
  const matched = (req.headers['x-matched-path'] as string) || (req.headers['x-now-route-matches'] as string);
  if (matched && (req.url === '/api/index' || req.url === '/api' || req.url?.startsWith('/api/index?'))) {
    req.url = matched;
  }

  return app(req, res);
}
