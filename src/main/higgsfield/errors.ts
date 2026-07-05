export class HiggsfieldCliError extends Error {
  constructor(
    message: string,
    readonly rawOutput?: string
  ) {
    super(message)
    this.name = 'HiggsfieldCliError'
  }
}
