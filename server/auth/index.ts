import type { Response, RequestHandler, CookieOptions } from 'express';
import * as stytch from 'stytch';

/**
 * Options for setting cookies.
 *
 * TODO: update your cookie options to meet your app’s security requirements!
 *
 * @default { path : '/' }
 * @see https://www.npmjs.com/package/cookies#cookiessetname--values--options
 */
export const cookieOptions: CookieOptions = { path: '/' };

/**
 * The URL for the Stytch API changes based on the environment you’re working
 * with. Using an env var makes it easier to switch environments for e.g. local
 * dev and production.
 *
 * @see https://stytch.com/docs/b2b/guides/dashboard/api-keys
 */
export const stytchEnv =
	process.env.STYTCH_PROJECT_ENV === 'live'
		? stytch.envs.live
		: stytch.envs.test;

/**
 * Make it possible to load the Stytch SDK’s B2B client anywhere in the backend
 * without creating multiple instances of the Stytch SDK.
 *
 * @see https://github.com/stytchauth/stytch-node?tab=readme-ov-file#example-b2b-usage
 */
let client: stytch.B2BClient;
export const loadStytch = () => {
	if (!client) {
		client = new stytch.B2BClient({
			project_id: process.env.STYTCH_PROJECT_ID ?? '',
			secret: process.env.STYTCH_SECRET ?? '',
			env: stytchEnv,
		});
	}

	return client;
};

/**
 * A helper for exchanging Stytch intermediate tokens for a fully authenticated
 * session for a given organization.
 *
 * @see https://stytch.com/docs/b2b/api/exchange-intermediate-session
 *
 * NOTE: The names of the cookies are important! The Stytch JavaScript SDK
 * requires these specific session names.
 *
 * @see https://stytch.com/docs/b2b/sdks/javascript-sdk/resources/cookies-and-session-management
 */
export async function exchangeIntermediateToken({
	res,
	intermediate_session_token,
	organization_id,
}: {
	res: Response;
	intermediate_session_token: string;
	organization_id: string;
}) {
	const stytch = loadStytch();

	const session = await stytch.discovery.intermediateSessions.exchange({
		intermediate_session_token,
		organization_id,
	});

	if (session.status_code !== 200) {
		res.status(session.status_code).json(session);
		return;
	}

	res.clearCookie('discovered_orgs');
	res.clearCookie('intermediate_token');

	res.cookie('stytch_member_id', session.member_id, cookieOptions);
	res.cookie('stytch_org_id', organization_id, cookieOptions);
	res.cookie('stytch_session', session.session_token, cookieOptions);
	res.cookie('stytch_session_jwt', session.session_jwt, cookieOptions);
}

/**
 * Express middleware for ensuring the user requesting a route has permission to
 * do the thing they’re trying to do. This uses Stytch RBAC authorization checks
 * under the hood.
 *
 * @see https://stytch.com/docs/b2b/guides/rbac/authorization-checks
 * @see https://stytch.com/docs/b2b/api/authenticate-session
 */
export function checkPermission(
	resource: string,
	action: string,
): RequestHandler {
	const stytch = loadStytch();

	return async (req, res, next) => {
		try {
			const response = await stytch.sessions.authenticate({
				session_token: req.cookies.stytch_session,
				authorization_check: {
					organization_id: req.cookies.stytch_org_id,
					resource_id: resource,
					action,
				},
			});

			if (response.verdict?.authorized) {
				next();
			} else {
				throw new Error('Unauthorized');
			}
		} catch (err) {
			res.status(401).json({ message: 'Unauthorized' });
			res.end();
		}
	};
}
