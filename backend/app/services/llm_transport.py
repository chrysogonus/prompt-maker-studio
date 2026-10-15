"""HTTP transport that pins user-provided endpoints to validated public IPs."""

import httpx2 as httpx

from app.services.llm_providers import InvalidConnectionError, public_host_addresses


class PublicLLMTransport(httpx.HTTPTransport):
    """Keep HTTP Host and TLS verification bound to the original hostname.

    Each provider client owns its transport and uses one origin; redirects are
    disabled on that client. Environment proxies are disabled so connections
    cannot re-resolve the hostname beyond this check.
    """

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        try:
            addresses = public_host_addresses(request.url.raw_host.decode("ascii"))
        except InvalidConnectionError as exc:
            raise httpx.ConnectError(str(exc), request=request) from exc
        for index, address in enumerate(addresses):
            pinned = httpx.Request(
                request.method,
                request.url.copy_with(host=address),
                headers=request.headers,
                stream=request.stream,
                extensions={
                    **request.extensions,
                    "sni_hostname": request.url.raw_host.decode("ascii"),
                },
            )
            try:
                return super().handle_request(pinned)
            except (httpx.ConnectError, httpx.ConnectTimeout):
                if index == len(addresses) - 1:
                    raise
        message = "No public provider address is available"
        raise httpx.ConnectError(message, request=request)
