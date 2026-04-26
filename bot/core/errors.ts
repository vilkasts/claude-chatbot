import Anthropic from "@anthropic-ai/sdk";

// We classify Anthropic SDK errors into useful buckets so log output tells
// the reader what kind of failure happened (auth vs. rate limit vs. network)
// without dumping a full stack trace at them.
export const describeError = (error: unknown): string => {
  if (error instanceof Anthropic.AuthenticationError) {
    return "Authentication failed - check ANTHROPIC_API_KEY in .env.";
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return "Permission denied by the Anthropic API for this resource.";
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "Rate limit hit - wait a bit and try the same message again.";
  }
  if (error instanceof Anthropic.BadRequestError) {
    return `Bad request to the Anthropic API: ${error.message}`;
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return "Network error talking to the Anthropic API - check your connection.";
  }
  if (error instanceof Anthropic.InternalServerError) {
    return "Anthropic API returned a server error - usually transient, retry.";
  }
  if (error instanceof Anthropic.APIError) {
    return `Anthropic API error (status ${error.status ?? "?"}): ${error.message}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
};

// Convenience wrapper that prepends a short context tag, e.g. "[chat] ...".
// Used wherever we print to console.error so the source of the failure is obvious.
export const formatErrorWithContext = (
  contextTag: string,
  error: unknown,
): string => `[${contextTag}] ${describeError(error)}`;
