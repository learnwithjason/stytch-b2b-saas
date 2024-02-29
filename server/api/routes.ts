import { Router } from 'express';
import {
	getIdeas,
	addIdea,
	deleteIdea,
	getUser,
	addUser,
} from '../db/index.js';
import { checkPermission, loadStytch } from '../auth/index.js';

export const api = Router();

// NOTE: leave the `/api` prefix off; that's added in the main app

api.get('/ideas', checkPermission('stytch.self', '*'), async (req, res) => {
	const allIdeas = await getIdeas(req.cookies.stytch_org_id);

	res.json(allIdeas);
});

api.post('/idea', checkPermission('stytch.self', '*'), async (req, res) => {
	const stytch = loadStytch();
	const orgId = req.cookies.stytch_org_id;
	const memberId = req.cookies.stytch_member_id;
	const currentMember = await getUser(memberId);

	if (!currentMember?.name) {
		const member = await stytch.organizations.members.get({
			organization_id: orgId,
			member_id: memberId,
		});
		await addUser({ id: member.member_id, name: member.member.name });
	}

	const result = await addIdea({
		text: req.body.text,
		status: 'pending',
		creator: memberId,
		team: orgId,
	});

	res.json(result.at(0));
});

api.delete('/idea', checkPermission('idea', 'delete'), async (req, res) => {
	const result = await deleteIdea(req.body.ideaId);

	res.json(result.at(0));
});

api.get(
	'/team',
	checkPermission('stytch.member', 'search'),
	async (req, res) => {
		const stytch = loadStytch();

		const response = await stytch.organizations.members.search({
			organization_ids: [req.cookies.stytch_org_id],
		});

		// simplify member data (only provide what gets shown client-side)
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
	},
);

api.get('/teams', checkPermission('stytch.self', '*'), async (req, res) => {
	const stytch = loadStytch();
	const response = await stytch.discovery.organizations.list({
		session_jwt: req.cookies.stytch_session_jwt,
	});

	const orgs = response.discovered_organizations.map(({ organization }) => {
		return {
			id: organization?.organization_id,
			name: organization?.organization_name,
		};
	});

	res.json(orgs);
});

api.get(
	'/team-settings',
	checkPermission('stytch.self', '*'),
	async (req, res) => {
		const stytch = loadStytch();

		const response = await stytch.organizations.get({
			organization_id: req.cookies.stytch_org_id,
		});

		res.json(response.organization);
	},
);

api.post(
	'/team-settings',
	checkPermission(
		'stytch.organization',
		'update.settings.allowed-auth-methods',
	),
	async (req, res) => {
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

		const response = await stytch.organizations.update(params);

		if (response.status_code !== 200) {
			res.sendStatus(response.status_code);
		}

		res.redirect(
			new URL('/dashboard/team-settings', process.env.APP_URL).toString(),
		);
	},
);

api.get('/account', checkPermission('stytch.self', '*'), async (req, res) => {
	const stytch = loadStytch();

	const response = await stytch.organizations.members.get({
		organization_id: req.cookies.stytch_org_id,
		member_id: req.cookies.stytch_member_id,
	});

	res.json(response.member);
});

api.post('/account', checkPermission('stytch.self', '*'), async (req, res) => {
	const stytch = loadStytch();

	const response = await stytch.organizations.members.update({
		organization_id: req.cookies.stytch_org_id,
		member_id: req.cookies.stytch_member_id,
		name: req.body.name,
	});

	if (response.status_code !== 200) {
		res.sendStatus(response.status_code);
	}

	res.redirect(new URL('/dashboard/account', process.env.APP_URL).toString());
});
