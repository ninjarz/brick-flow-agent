/** Provider failures must not be retried as invalid geometry. */
export class LlmServiceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'LlmServiceError'
  }
}
