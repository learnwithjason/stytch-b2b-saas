import type {
	B2BMagicLinksDiscoveryAuthenticateResponse,
	B2BOAuthDiscoveryAuthenticateResponse,
	B2BMagicLinksAuthenticateResponse,
} from 'stytch';
import { Router } from 'express';
import {
	loadStytch,
	exchangeIntermediateToken,
	cookieOptions,
	stytchEnv,
} from './index.js';

export const auth = Router();

/**
 * OAuth discovery lets members use their Google or Microsoft accounts for auth.
 *
 * @see https://stytch.com/docs/b2b/guides/oauth/discovery
 */
auth.get('/discovery/:method', (req, res) => {
	const { method } = req.params;

	if (!['google', 'microsoft'].includes(method)) {
		throw new Error(`method ${method} is unsupported`);
	}

	const stytchApi = new URL(`${stytchEnv}.stytch.com`);

	stytchApi.pathname = `/v1/b2b/public/oauth/${method}/discovery/start`;
	stytchApi.searchParams.set(
		'public_token',
		process.env.STYTCH_PUBLIC_TOKEN ?? '',
	);

	res.redirect(stytchApi.toString());
});

/**
 * Magic links let members use their email for auth without the hassle of
 * managing passwords.
 *
 * @see https://stytch.com/docs/b2b/guides/magic-links/send-discover-eml
 */
auth.post('/discovery/email', (req, res) => {
	const stytch = loadStytch();
	const email_address = req.body.email_address;

	stytch.magicLinks.email.discovery.send({ email_address });

	res.status(200).json({ message: 'Please check your email' });
});

/**
 * NOTE: This app doesn’t implement it, but it’s possible to add a password
 * flow if you prefer that auth method.
 *
 * @see https://stytch.com/docs/b2b/guides/passwords/api
 */

/**
 * The redirect handler does a LOT of work in the auth flow. There are several
 * ways that members can authenticate. In this app, we implement handlers for
 * the magic link and OAuth discovery flows. Discovery allows each member to
 * choose the organization they want to log into.
 *
 * It’s also possible to use a custom URL for each organization if you don’t
 * want to use discovery. For more details, see the multi-tenancy docs:
 *
 * @see https://stytch.com/docs/b2b/guides/multi-tenancy
 */
auth.get('/redirect', async (req, res) => {
	const stytch = loadStytch();

	const type = req.query.stytch_token_type;
	const token = req.query.token as string;

	let response:
		| B2BOAuthDiscoveryAuthenticateResponse
		| B2BMagicLinksDiscoveryAuthenticateResponse
		| B2BMagicLinksAuthenticateResponse;

	if (type === 'discovery_oauth') {
		response = await stytch.oauth.discovery.authenticate({
			discovery_oauth_token: token,
		});
	} else if (type === 'discovery') {
		response = await stytch.magicLinks.discovery.authenticate({
			discovery_magic_links_token: token,
		});
	} else if (type === 'multi_tenant_magic_links') {
		response = await stytch.magicLinks.authenticate({
			magic_links_token: token,
		});

		await exchangeIntermediateToken({
			res,
			intermediate_session_token: response.intermediate_session_token,
			organization_id: response.organization_id,
		});

		res.redirect(307, new URL('/dashboard', process.env.APP_URL).toString());
		return;
	} else {
		// if we get here, the request is unsupported so we return an error
		res.status(500).send(`unknown token type ${req.body.stytch_token_type}`);
		return;
	}

	const orgs = response.discovered_organizations;
	const intermediateToken = response.intermediate_session_token;

	const discovered_orgs = orgs.map((org) => {
		return {
			id: org.organization?.organization_id,
			name: org.organization?.organization_name,
			status: org.membership?.type,
		};
	});

	res.cookie('intermediate_token', intermediateToken, cookieOptions);
	res.cookie('discovered_orgs', JSON.stringify(discovered_orgs), cookieOptions);

	/*
	 * Now that we’ve discovered the member’s available orgs, we need to show them
	 * UI so they can choose which one they want to auth into. Redirect to a page
	 * that shows existing organizations (if any) and an option to create a new
	 * organization.
	 */
	res.redirect(
		307,
		new URL('/dashboard/select-team', process.env.APP_URL).toString(),
	);
});

/**
 * Once the member selects an organization, create a full session for them.
 * Check the definition of {@link exchangeIntermediateToken} for details.
 */
auth.get('/select-team', async (req, res) => {
	await exchangeIntermediateToken({
		res,
		intermediate_session_token: req.cookies.intermediate_token,
		organization_id: req.query.org_id as string,
	});

	res.redirect(303, new URL('/dashboard', process.env.APP_URL).toString());
});

/**
 * Stytch is organization-first, but it’s still possible for a member to switch
 * organizations without needing to auth again. This is done by exchanging their
 * current session (tied to the current org ID) for a new one that’s tied to the
 * other org ID.
 *
 * @see https://stytch.com/docs/b2b/api/exchange-session
 */
auth.post('/switch-team', async (req, res) => {
	if (req.body.organization_id === 'new') {
		res.redirect('/auth/logout');
		return;
	}

	const stytch = loadStytch();

	const result = await stytch.sessions.exchange({
		organization_id: req.body.organization_id,
		session_token: req.cookies.stytch_session,
	});

	// if there’s a problem (e.g. auth methods don’t match) we need to auth again
	if (result.status_code !== 200) {
		res.redirect('/auth/logout');
		return;
	}

	res.cookie(
		'stytch_org_id',
		result.organization.organization_id,
		cookieOptions,
	);
	res.cookie('stytch_member_id', result.member_id, cookieOptions);
	res.cookie('stytch_session', result.session_token, cookieOptions);
	res.cookie('stytch_session_jwt', result.session_jwt, cookieOptions);

	res.redirect(303, new URL('/dashboard', process.env.APP_URL).toString());
});

/**
 * Revoke all sessions for the current member and clear cookies.
 *
 * @see https://stytch.com/docs/b2b/api/revoke-session
 */
auth.get('/logout', async (req, res) => {
	const stytch = loadStytch();

	stytch.sessions.revoke({ member_id: req.cookies.stytch_member_id });

	res.clearCookie('stytch_member_id');
	res.clearCookie('stytch_org_id');
	res.clearCookie('stytch_session');
	res.clearCookie('stytch_session_jwt');

	res.redirect(new URL('/dashboard/login', process.env.APP_URL).toString());
});
