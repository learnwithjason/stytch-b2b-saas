import { Router } from 'express';
import { getOauthUrl, loadStytch, exchangeIntermediateToken } from './index.js';
import type {
	B2BMagicLinksDiscoveryAuthenticateResponse,
	B2BOAuthDiscoveryAuthenticateResponse,
	B2BMagicLinksAuthenticateResponse,
} from 'stytch';

export const auth = Router();

auth.get('/discovery/google', (_req, res) => {
	res.redirect(getOauthUrl('google'));
});

auth.get('/discovery/microsoft', (_req, res) => {
	res.redirect(getOauthUrl('microsoft'));
});

auth.post('/discovery/email', (req, res) => {
	const stytch = loadStytch();
	const email_address = req.body.email_address;

	stytch.magicLinks.email.discovery.send({ email_address });

	res.status(200).json({ message: 'Please check your email' });
});

auth.get('/redirect', async (req, res) => {
	const stytch = loadStytch();

	const type = req.query.stytch_token_type;
	const token = req.query.token as string;
	let response:
		| B2BOAuthDiscoveryAuthenticateResponse
		| B2BMagicLinksDiscoveryAuthenticateResponse
		| B2BMagicLinksAuthenticateResponse
		| false;
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
		response = false;

		res.status(500).send(`unknown token type ${req.body.stytch_token_type}`);
		return;
	}

	// TODO: handle other redirect types (reset password)

	const orgs = response.discovered_organizations;
	const intermediateToken = response.intermediate_session_token;

	const discovered_orgs = orgs.map((org) => {
		return {
			id: org.organization?.organization_id,
			name: org.organization?.organization_name,
			status: org.membership?.type,
		};
	});

	res.cookie('intermediate_token', intermediateToken, { path: '/' });
	res.cookie('discovered_orgs', JSON.stringify(discovered_orgs), {
		path: '/',
	});

	res.redirect(
		307,
		new URL('/dashboard/select-team', process.env.APP_URL).toString(),
	);
});

auth.get('/select-team', async (req, res) => {
	await exchangeIntermediateToken({
		res,
		intermediate_session_token: req.cookies.intermediate_token,
		organization_id: req.query.org_id as string,
	});

	res.redirect(303, new URL('/dashboard', process.env.APP_URL).toString());
});

/*
 * If no organization exists:
 * Step 3: create a new organization for the user
 *
 * B2B apps are org-first, so users MUST create or join an organization as part
 * of signup.
 */
auth.post('/register', async (req, res) => {
	const token = req.cookies.intermediate_token;
	const organization = req.body.organization;
	const slug = organization
		.trim()
		.toLowerCase()
		.replace(/[\s+~\/]/g, '-')
		.replace(/[().`,%·'"!?¿:@*]/g, '');

	const stytch = loadStytch();

	const result = await stytch.discovery.organizations.create({
		intermediate_session_token: token,
		organization_name: organization,
		organization_slug: slug,
	});

	// TODO add the required resources and roles to the new organization

	res.clearCookie('intermediate_token');

	res.cookie('stytch_member_id', result.member.member_id, { path: '/' });
	res.cookie('stytch_org_id', result.organization?.organization_id, {
		path: '/',
	});
	res.cookie('stytch_session', result.session_token, { path: '/' });
	res.cookie('stytch_session_jwt', result.session_jwt, { path: '/' });

	res.redirect(303, new URL('/dashboard', process.env.APP_URL).toString());
});

auth.get('/logout', async (_req, res) => {
	res.clearCookie('stytch_member_id');
	res.clearCookie('stytch_org_id');
	res.clearCookie('stytch_session');
	res.clearCookie('stytch_session_jwt');

	res.redirect(new URL('/dashboard/login', process.env.APP_URL).toString());
});
