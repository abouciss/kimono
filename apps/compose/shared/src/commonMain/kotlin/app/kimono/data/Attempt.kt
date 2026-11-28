package app.kimono.data

import kotlinx.coroutines.CancellationException

/**
 * [runCatching] that lets a cancellation through. Compose cancels a screen's work when the screen
 * goes, or when what it was asked for changes (a search typed on); caught as a failure, that
 * cancellation turned up as the screen's problem ("The coroutine scope left the composition") and
 * stopped the work from ending as it should.
 */
inline fun <T> attempt(block: () -> T): Result<T> =
    try { Result.success(block()) } catch (c: CancellationException) { throw c } catch (e: Throwable) { Result.failure(e) }
