export default function handler(request, response) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  const requestOrigin = request.headers.origin;

  if (allowedOrigin && requestOrigin === allowedOrigin) {
    response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    response.setHeader('Vary', 'Origin');
  }

  response.status(200).json({
    ok: true,
    service: 'agent-dev-dual-preview-spike',
  });
}
