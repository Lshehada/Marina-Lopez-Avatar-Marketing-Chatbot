export function errorHandler(err, _req, res, _next) {
  console.error(err);

  const status =
    err.name === 'ZodError'
      ? 400
      : err.status || 500;

  res.status(status).json({
    error:
      status === 500
        ? 'Internal server error'
        : err.message
  });
}