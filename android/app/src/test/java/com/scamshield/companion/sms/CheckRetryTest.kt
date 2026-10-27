package com.scamshield.companion.sms

import com.scamshield.companion.net.ApiException
import com.scamshield.companion.net.UnauthorizedException
import com.scamshield.companion.sms.CheckRetry.Step
import org.json.JSONException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.SocketTimeoutException
import java.net.UnknownHostException

class CheckRetryTest {

    @Test fun network_errors_are_transient() {
        assertTrue(CheckRetry.isTransient(UnknownHostException("no network")))
        assertTrue(CheckRetry.isTransient(SocketTimeoutException()))
        assertTrue(CheckRetry.isTransient(JSONException("captive portal html")))
    }

    @Test fun server_overload_is_transient() {
        assertTrue(CheckRetry.isTransient(ApiException(503, null)))
        assertTrue(CheckRetry.isTransient(ApiException(500, "boom")))
        assertTrue(CheckRetry.isTransient(ApiException(429, null)))
        assertTrue(CheckRetry.isTransient(ApiException(408, null)))
    }

    @Test fun revoked_token_and_client_errors_are_not_retried() {
        assertFalse(CheckRetry.isTransient(UnauthorizedException()))
        assertFalse(CheckRetry.isTransient(ApiException(400, "bad body")))
        assertFalse(CheckRetry.isTransient(ApiException(404, null)))
    }

    @Test fun retries_five_times_then_gives_up_on_the_sixth_attempt() {
        for (attempt in 0 until 5) assertEquals("attempt $attempt", Step.RETRY, CheckRetry.afterFailure(attempt, transient = true))
        assertEquals(Step.GIVE_UP, CheckRetry.afterFailure(5, transient = true))
        assertEquals(Step.GIVE_UP, CheckRetry.afterFailure(9, transient = true))
        assertEquals(6, CheckRetry.MAX_ATTEMPTS)
    }

    @Test fun permanent_errors_give_up_at_once() =
        assertEquals(Step.GIVE_UP, CheckRetry.afterFailure(0, transient = false))
}
