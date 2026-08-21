'use client';

import { createAuthClient } from 'better-auth/react';
import { oauthProviderClient } from '@better-auth/oauth-provider/client';

/**
 * The oauthProviderClient fetch plugin forwards the signed `oauth_query`
 * (present while an OAuth authorization is in flight) on every non-GET auth
 * call - which is what lets our own email/password sign-in resume a pending
 * MCP client authorization without AuthForm knowing OAuth exists.
 */
export const authClient = createAuthClient({ plugins: [oauthProviderClient()] });
export const { signIn, signUp, signOut, useSession } = authClient;
