import type { Response, RequestHandler } from 'express';
import * as stytch from 'stytch';

const stytchEnv =
	process.env.STYTCH_PROJECT_ENV === 'live'
		? stytch.envs.live
		: stytch.envs.test;

const stytchApi = new URL(`${stytchEnv}.stytch.com`);
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

export function getOauthUrl(service: 'google' | 'microsoft') {
	if (!['google', 'microsoft'].includes(service)) {
		throw new Error(`service ${service} is unsupported`);
	}

	stytchApi.pathname = `/v1/b2b/public/oauth/${service}/discovery/start`;
	stytchApi.searchParams.set(
		'public_token',
		process.env.STYTCH_PUBLIC_TOKEN ?? '',
	);

	return stytchApi.toString();
}

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

	res.cookie('stytch_member_id', session.member_id, { path: '/' });
	res.cookie('stytch_org_id', organization_id, { path: '/' });
	res.cookie('stytch_session', session.session_token, { path: '/' });
	res.cookie('stytch_session_jwt', session.session_jwt, { path: '/' });
}

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
