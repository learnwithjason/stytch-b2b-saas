/**
 * Important note about this file!
 *
 * The routes in here are for making the example SaaS app function. They’re
 * intended as a reference for how you can handle similar flows in your own app.
 * All of the logic around adding and deleting ideas and users is intended to be
 * replaced with your own SaaS logic.
 *
 * The most relevant things to note are:
 *
 *  - the {@link checkPermission} middleware for authorization checks on custom
 * 		roles and resources
 *  - how member data from Stytch is synced with the app’s database in e.g. the
 * 		`POST /idea` route
 *  - how organization and member settings are surfaced to members so they can
 * 		manage Stytch settings from within the app itself in e.g. `POST /account`
 */

import { Router } from 'express';
import {
	getIdeas,
	addIdea,
	deleteIdea,
	getUser,
	addUser,
	updateUserName,
} from '../db/index.js';
import { checkPermission, loadStytch } from '../auth/index.js';

export const api = Router();

/**
 * For custom resources in your app that are available to all members, a check
 * for the `stytch.self` role and `*` action is sufficient.
 *
 * @see https://stytch.com/docs/b2b/guides/rbac/stytch-defaults
 */
api.get('/ideas', checkPermission('stytch.self', '*'), async (req, res) => {
	const allIdeas = await getIdeas(req.cookies.stytch_org_id);

	res.json(allIdeas);
});

api.post('/idea', checkPermission('stytch.self', '*'), async (req, res) => {
	const stytch = loadStytch();
	const orgId = req.cookies.stytch_org_id;
	const memberId = req.cookies.stytch_member_id;
	const currentMember = await getUser(memberId);

	if (!currentMember?.id) {
		const { member } = await stytch.organizations.members.get({
			organization_id: orgId,
			member_id: memberId,
		});

		await addUser({ id: member.member_id, name: member.name });
	}

	const result = await addIdea({
		text: req.body.text,
		status: 'pending',
		creator: memberId,
		team: orgId,
	});

	res.json(result.at(0));
});

/**
 * For custom resources in your app that are only available to privileged roles,
 * you can set up custom resources and actions.
 *
 * @see https://stytch.com/docs/b2b/guides/rbac/overview
 */
api.delete('/idea', checkPermission('idea', 'delete'), async (req, res) => {
	const result = await deleteIdea(req.body.ideaId);

	res.json(result.at(0));
});

/**
 * When the action you’re protecting is specific to Stytch (e.g. loading member
 * or organization details), the Stytch session can be passed direclty into the
 * SDK calls instead of performing a separate permission check.
 *
 * This flow is described in the “RBAC-gated endpoints in the API” section of
 * the Stytch docs.
 *
 * @see https://stytch.com/docs/b2b/guides/rbac/authorization-checks
 */
api.get('/team', async (req, res) => {
	const stytch = loadStytch();

	const response = await stytch.organizations.members.search(
		{
			organization_ids: [req.cookies.stytch_org_id],
		},
		{
			// passing the JWT here enforces RBAC for the member
			authorization: {
				session_jwt: req.cookies.stytch_session_jwt,
			},
		},
	);

	/*
	 * Not all the details of each member need to be sent to the client. Mapping
	 * over the results to choose only the fields we need reduces how much data
	 * is sent in each request and is a good privacy practice.
	 */
	const members = response.members.map((member) => {
		return {
			id: member.member_id,
			name: member.name,
			email: member.email_address,
			status: member.status,
			roles: member.roles
				.filter((role) => !role.role_id.startsWith('stytch_'))
				.map((role) => role.role_id),
		};
	});

	res.json({
		members,
		meta: {
			invites_allowed:
				Object.values(response.organizations).at(0)?.email_invites ===
				'ALL_ALLOWED',
		},
	});
});

api.get('/team-settings', async (req, res) => {
	const stytch = loadStytch();

	const response = await stytch.organizations.get({
		organization_id: req.cookies.stytch_org_id,
	});

	res.json(response.organization);
});

api.post('/team-settings', async (req, res) => {
	const stytch = loadStytch();

	const {
		email_invites,
		allowed_auth_methods,
		email_allowed_domains,
		email_jit_provisioning,
	} = req.body;
	const auth_methods = [
		'sso',
		'magic_link',
		'password',
		'google_oauth',
		'microsoft_oauth',
	].every((m) => allowed_auth_methods.includes(m))
		? 'ALL_ALLOWED'
		: 'RESTRICTED';

	const params: any = {
		organization_id: req.cookies.stytch_org_id,
		allowed_auth_methods,
		auth_methods,
		email_invites: email_invites ? 'ALL_ALLOWED' : 'NOT_ALLOWED',
	};

	if (email_allowed_domains.length > 0) {
		params.email_allowed_domains = email_allowed_domains
			.split(',')
			.map((d: string) => d.trim());
	}

	if (email_jit_provisioning && email_allowed_domains.length > 0) {
		params.email_jit_provisioning = 'RESTRICTED';
	} else {
		params.email_jit_provisioning = 'NOT_ALLOWED';
	}

	const response = await stytch.organizations.update(params, {
		// passing the JWT here enforces RBAC for the member
		authorization: {
			session_jwt: req.cookies.stytch_session_jwt,
		},
	});

	if (response.status_code !== 200) {
		res.sendStatus(response.status_code);
	}

	res.redirect(
		new URL('/dashboard/team-settings', process.env.APP_URL).toString(),
	);
});

api.get('/account', async (req, res) => {
	const stytch = loadStytch();

	const response = await stytch.organizations.members.get({
		organization_id: req.cookies.stytch_org_id,
		member_id: req.cookies.stytch_member_id,
	});

	res.json(response.member);
});

api.post('/account', async (req, res) => {
	const stytch = loadStytch();

	const response = await stytch.organizations.members.update(
		{
			organization_id: req.cookies.stytch_org_id,
			member_id: req.cookies.stytch_member_id,
			name: req.body.name,
		},
		{
			// passing the JWT here enforces RBAC for the member
			authorization: {
				session_jwt: req.cookies.stytch_session_jwt,
			},
		},
	);

	await updateUserName(req.cookies.stytch_member_id, req.body.name);

	if (response.status_code !== 200) {
		res.sendStatus(response.status_code);
	}

	res.redirect(new URL('/dashboard/account', process.env.APP_URL).toString());
});
