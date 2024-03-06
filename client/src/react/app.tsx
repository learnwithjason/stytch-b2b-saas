/*
 * Why is this whole app jammed into a single file?
 * ================================================
 *
 * The short answer is: this is the part that you’ll (probably) delete when you
 * build your own app.
 *
 * This is the layout and logic for the demo. Aside from the usage of the auth
 * components, most of this is only here to provide a demo that’s more
 * interesting than a hello world.
 *
 * Once you’ve seen how the Stytch auth components are used, you can safely
 * remove all of this code and replace it with your own app.
 */

import React, { useState, type ReactNode, useEffect } from 'react';
import {
	Routes,
	Route,
	Outlet,
	Link,
	BrowserRouter,
	useNavigate,
	useLocation,
	Navigate,
} from 'react-router-dom';
import {
	QueryClient,
	QueryClientProvider,
	useMutation,
	useQuery,
	useQueryClient,
} from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

import {
	StytchB2BProvider,
	useStytchB2BClient,
	useStytchMember,
	useStytchMemberSession,
	useStytchIsAuthorized,
} from '@stytch/react/b2b';
import { StytchB2BHeadlessClient } from '@stytch/vanilla-js/b2b/headless';

import { Idea } from './components/idea';
import logo from '../images/squircle-logo-purple.png';
import styles from './app.module.css';

function getCookie(name: string) {
	const cookies = document.cookie.split('; ');
	const cookie = cookies.find((c) => c.startsWith(`${name}=`));
	const value = cookie?.split('=').at(1) ?? '';

	return decodeURIComponent(value);
}

const Layout = () => {
	const { session } = useStytchMemberSession();

	return (
		<main className={styles.dashboard}>
			<section className={styles.page}>
				<Outlet />
			</section>

			<aside className={styles.sidebar}>
				<div className={styles['sidebar-header']}>
					<a href="/" rel="home">
						<img {...logo} alt="Squircle logo" width="36" height="36" />
						Squircle
					</a>
				</div>

				{session?.member_id ? (
					<>
						<h3>Dashboard</h3>
						<nav>
							<Link to="/dashboard">View all ideas &rarr;</Link>
							<Link to="/dashboard/add">Add Idea +</Link>
						</nav>

						<h3>Team</h3>
						<nav>
							<Link to="/dashboard/team">Team Members</Link>
							<Link to="/dashboard/team-settings">Team Settings</Link>
							<a
								href={new URL(
									'/auth/logout',
									import.meta.env.PUBLIC_API_URL,
								).toString()}
							>
								Switch Teams
							</a>
						</nav>

						<h3>Account</h3>
						<nav>
							<Link to="/dashboard/account">Account Settings</Link>
							<a
								href={new URL(
									'/auth/logout',
									import.meta.env.PUBLIC_API_URL,
								).toString()}
							>
								Log Out
							</a>
						</nav>
					</>
				) : null}
			</aside>
		</main>
	);
};

const Header = ({ heading }: { heading: string }) => {
	return (
		<header>
			<h1>{heading}</h1>
		</header>
	);
};

function RequireAuth({ children }: { children: ReactNode }) {
	const { session, fromCache } = useStytchMemberSession();
	const [redirectTimeout, setRedirectTimeout] = useState<number>();
	const navigate = useNavigate();
	let location = useLocation();

	useEffect(() => {
		if (!session) {
			const timeoutId = setTimeout(() => {
				navigate('/dashboard/login', {
					state: {
						from: location,
					},
					replace: true,
				});
			}, 1000);

			setRedirectTimeout((prevId) => {
				clearInterval(prevId);
				return timeoutId;
			});
		} else {
			clearTimeout(redirectTimeout);
			setRedirectTimeout(undefined);
		}
	}, [session, fromCache]);

	return session ? children : null;
}

const PageWithQuery = ({
	heading,
	apiRoute,
	staleTime,
	children,
}: {
	heading: string;
	apiRoute: string;
	staleTime?: number;
	children?({
		data,
		isPending,
		error,
	}: {
		data: any;
		isPending: boolean;
		error: any;
	}): any;
}) => {
	const { isPending, error, data } = useQuery({
		queryKey: [apiRoute],
		queryFn: () => {
			const api = new URL(apiRoute, import.meta.env.PUBLIC_API_URL);

			return fetch(api, { credentials: 'include' })
				.then((res) => res.json())
				.catch((error) => {
					throw new Error(error);
				});
		},
		staleTime,
	});

	if (isPending) {
		return (
			<div>
				<p>loading...</p>
			</div>
		);
	}

	if (error) {
		return <pre>{JSON.stringify(error, null, 2)}</pre>;
	}

	return (
		<>
			<Header heading={heading} />

			{children ? (
				children({ data, isPending, error })
			) : (
				<div>
					<details>
						<summary>Debug info:</summary>
						<pre>{JSON.stringify(data, null, 2)}</pre>
					</details>
				</div>
			)}
		</>
	);
};

const DashboardHome = () => {
	return (
		<RequireAuth>
			<PageWithQuery
				heading="Ideas"
				apiRoute="/api/ideas"
				staleTime={1000 * 60}
			>
				{({ data }) => {
					if (data.message) {
						return (
							<div>
								<p>{data.message}</p>
							</div>
						);
					}

					return (
						<ul className={styles.ideas}>
							{data.map((idea: Idea) => (
								<Idea key={idea.id} {...idea} />
							))}
						</ul>
					);
				}}
			</PageWithQuery>
		</RequireAuth>
	);
};

const DashboardAdd = () => {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { member } = useStytchMember();

	const api = new URL('/api/idea', import.meta.env.PUBLIC_API_URL);
	const addIdea = useMutation({
		mutationFn: ({ text }: { text: string }) => {
			const data = new URLSearchParams();
			data.append('text', text);

			return fetch(api, {
				method: 'post',
				body: data,
				credentials: 'include',
			}).then((res) => res.json());
		},
		onSuccess: async (newIdea) => {
			await queryClient.cancelQueries({ queryKey: ['/api/ideas'] });

			queryClient.setQueryData(['/api/ideas'], (old: Idea[]) => [
				...old,
				{ ...newIdea, creator: member?.name },
			]);
		},
		onSettled: async () => {
			navigate('/dashboard');
		},
	});

	return (
		<RequireAuth>
			<Header heading="Add an idea" />
			<div>
				<form
					action={api.toString()}
					method="POST"
					onSubmit={(e) => {
						e.preventDefault();

						const data = new FormData(e.currentTarget);
						const text = data.get('text') as string;

						if (!text) {
							console.log('oh no');
							return;
						}

						addIdea.mutate({ text });
					}}
				>
					<label htmlFor="text">Idea</label>
					<input id="text" name="text" type="text" required />

					<button type="submit">Add Idea</button>
				</form>
			</div>
		</RequireAuth>
	);
};

const DashboardTeamMembers = () => {
	const stytch = useStytchB2BClient();
	const invite = useStytchIsAuthorized('stytch.member', 'create');
	const { session } = useStytchMemberSession();
	const queryClient = useQueryClient();
	const [pending, setPending] = useState<string>();
	const [inviteMessage, setInviteMessage] = useState<string>();

	return (
		<RequireAuth>
			<PageWithQuery
				heading="Team Members"
				apiRoute="/api/team"
				staleTime={1000 * 60}
			>
				{({ data }) => {
					if (data.message === 'Unauthorized') {
						return (
							<div>
								<p>You don’t have permission to see this information.</p>
							</div>
						);
					}

					return (
						<div className={styles.teamMembers}>
							<ul>
								{data.members.map((member: any) => {
									const isAdmin = member.roles.includes('admin');
									let buttonText = isAdmin
										? 'revoke admin role'
										: 'grant admin role';

									if (pending === member.id) {
										buttonText = 'updating...';
									}

									return (
										<li key={member.id}>
											{member.name} ({member.email})
											<span
												className={styles.memberStatus}
												data-status={member.status}
											>
												{member.status}
											</span>
											<span className={styles.memberRoles}>
												{member.roles.join(', ')}
											</span>
											{session?.roles.includes('admin') ? (
												<button
													onClick={(e) => {
														e.preventDefault();
														setPending(member.id);

														const roles = new Set(member.roles);

														if (isAdmin) {
															roles.delete('admin');
														} else {
															roles.add('admin');
														}

														stytch.organization.members.update({
															member_id: member.id,
															roles: [...roles.values()] as string[],
														});

														setTimeout(async () => {
															await queryClient.invalidateQueries({
																queryKey: ['/api/team'],
															});

															setPending(undefined);
														}, 1000);
													}}
												>
													{buttonText}
												</button>
											) : null}
										</li>
									);
								})}
							</ul>

							{inviteMessage ? (
								<div className={styles.inviteMessage}>
									<p>{inviteMessage}</p>
								</div>
							) : null}

							{data.meta.invites_allowed && invite.isAuthorized ? (
								<>
									<h2>Invite a new team member</h2>
									<form
										onSubmit={async (e) => {
											e.preventDefault();
											const formData = new FormData(e.currentTarget);
											const email = formData.get('email') as string;

											const data = await stytch.magicLinks.email.invite({
												email_address: email,
											});

											console.log(data);

											setInviteMessage(`Invite sent to ${email}`);
											queryClient.invalidateQueries({
												queryKey: ['/api/team'],
											});
										}}
									>
										<label htmlFor="email">Email</label>
										<input type="email" name="email" id="email" required />

										<button type="submit">Invite</button>
									</form>
								</>
							) : null}

							<details>
								<summary>Debug info:</summary>
								<p>
									Team members are loaded from{' '}
									<a href="https://stytch.com/docs/b2b/api/search-members">
										https://stytch.com/docs/b2b/api/search-members
									</a>
								</p>
								<pre>{JSON.stringify(data, null, 2)}</pre>
							</details>
						</div>
					);
				}}
			</PageWithQuery>
		</RequireAuth>
	);
};

const DashboardTeamSettings = () => {
	const jit = useStytchIsAuthorized(
		'stytch.organization',
		'update.settings.sso-jit-provisioning',
	);
	const invites = useStytchIsAuthorized(
		'stytch.organization',
		'update.settings.email-invites',
	);
	const allowedDomains = useStytchIsAuthorized(
		'stytch.organization',
		'update.settings.allowed-domains',
	);
	const allowedAuthMethods = useStytchIsAuthorized(
		'stytch.organization',
		'update.settings.allowed-auth-methods',
	);
	const isAuthorizedForAnySetting =
		jit.isAuthorized ||
		invites.isAuthorized ||
		allowedDomains.isAuthorized ||
		allowedAuthMethods.isAuthorized;
	const api = new URL('/api/team-settings', import.meta.env.PUBLIC_API_URL);

	return (
		<RequireAuth>
			<PageWithQuery heading="Team Settings" apiRoute="/api/team-settings">
				{({ data }) => {
					return (
						<div>
							<form action={api.toString()} method="POST">
								<label htmlFor="invites">
									<input
										type="checkbox"
										name="email_invites"
										id="invites"
										defaultChecked={data.email_invites === 'ALL_ALLOWED'}
										disabled={!invites.isAuthorized}
									/>
									Allow all team members to invite new members
								</label>

								<label htmlFor="jit">
									<input
										type="checkbox"
										name="email_jit_provisioning"
										id="jit"
										defaultChecked={
											data.email_jit_provisioning === 'RESTRICTED'
										}
										disabled={!jit.isAuthorized}
									/>
									Allow JIT provisioning for allowed email domains
								</label>

								<label htmlFor="allowed_domains">
									Allowed domains for invites
								</label>
								<input
									type="text"
									name="email_allowed_domains"
									id="allowed_domains"
									defaultValue={data.email_allowed_domains?.join(', ') ?? ''}
									disabled={!allowedDomains.isAuthorized}
								/>

								<fieldset>
									<legend>
										Allow team members to sign in with the following auth
										methods:
									</legend>

									{[
										{ name: 'sso', label: 'SSO' },
										{ name: 'magic_link', label: 'Magic Link' },
										{ name: 'password', label: 'Password' },
										{ name: 'google_oauth', label: 'Google OAuth' },
										{ name: 'microsoft_oauth', label: 'Microsoft OAuth' },
									].map(({ name, label }) => (
										<label key={`auth_method_${name}`} htmlFor={name}>
											<input
												type="checkbox"
												name="allowed_auth_methods"
												id={name}
												value={name}
												defaultChecked={
													data.auth_methods === 'ALL_ALLOWED' ||
													data.allowed_auth_methods.includes(name)
												}
												disabled={!allowedAuthMethods.isAuthorized}
											/>
											{label}
										</label>
									))}
								</fieldset>

								{isAuthorizedForAnySetting ? (
									<button type="submit">Update Team Settings</button>
								) : null}
							</form>

							<details>
								<summary>Debug info:</summary>
								<p>
									Organization settings are loaded from{' '}
									<a href="https://stytch.com/docs/b2b/api/org-auth-settings">
										https://stytch.com/docs/b2b/api/org-auth-settings
									</a>
								</p>
								<pre>{JSON.stringify(data, null, 2)}</pre>
							</details>
						</div>
					);
				}}
			</PageWithQuery>
		</RequireAuth>
	);
};

const DashboardAccount = () => {
	const api = new URL('/api/account', import.meta.env.PUBLIC_API_URL);

	return (
		<RequireAuth>
			<PageWithQuery heading="Account Settings" apiRoute="/api/account">
				{({ data }) => {
					return (
						<div>
							<form action={api.toString()} method="POST">
								<label htmlFor="name">Display Name</label>
								<input
									type="text"
									name="name"
									id="name"
									defaultValue={data.name ?? ''}
								/>

								<button type="submit">Update Display Name</button>
							</form>

							<details>
								<summary>Debug info:</summary>
								<p>
									Account settings are loaded from{' '}
									<a href="https://stytch.com/docs/b2b/api/get-member">
										https://stytch.com/docs/b2b/api/get-member
									</a>
								</p>
								<pre>{JSON.stringify(data, null, 2)}</pre>
							</details>
						</div>
					);
				}}
			</PageWithQuery>
		</RequireAuth>
	);
};

const DashboardLogin = () => {
	const apiUrl = import.meta.env.PUBLIC_API_URL;
	const emailDiscovery = new URL('/auth/discovery/email', apiUrl);
	const googleOauth = new URL('/auth/discovery/google', apiUrl);
	const microsoftOauth = new URL('/auth/discovery/microsoft', apiUrl);
	const [message, setMessage] = useState<string>();

	const startEmailDiscovery = useMutation({
		mutationFn: ({ email_address }: { email_address: string }) => {
			const data = new URLSearchParams();
			data.append('email_address', email_address);

			return fetch(emailDiscovery, {
				method: 'post',
				body: data,
				credentials: 'include',
			}).then((res) => res.json());
		},
		onSettled: async (data) => {
			setMessage(data.message);
		},
	});

	return (
		<>
			<Header heading="Sign Up or Log In" />

			<div className={styles.loginSection}>
				{message ? <div className={styles.loginMessage}>{message}</div> : null}

				<form
					onSubmit={(e) => {
						e.preventDefault();

						const data = new FormData(e.currentTarget);
						const email_address = data.get('email_address') as string;

						if (!email_address) {
							setMessage('Please provide an email address.');
							return;
						}

						startEmailDiscovery.mutate({ email_address });
					}}
				>
					<label htmlFor="email">Email</label>
					<input type="email" name="email_address" id="email" required />

					<button type="submit">Sign Up / Log In</button>
				</form>

				<a href={googleOauth.toString()}>Log in with Google</a>
				<a href={microsoftOauth.toString()}>Log in with Microsoft</a>
			</div>
		</>
	);
};

const DashboardRegister = () => {
	const location = useLocation();
	const api = new URL('/auth/register', import.meta.env.PUBLIC_API_URL);
	const token = getCookie('intermediate_token');

	if (!token || token.length < 1) {
		return (
			<Navigate to="/dashboard/login" state={{ from: location }} replace />
		);
	}

	return (
		<>
			<Header heading="Create a Team" />

			<div>
				<form action={api.toString()} method="POST" className="login-section">
					<label htmlFor="org">Create a Team</label>
					<input id="org" name="organization" />

					<button type="submit">Create Team</button>
				</form>
			</div>
		</>
	);
};

const DashboardSelectTeam = () => {
	const api = new URL('/auth/register', import.meta.env.PUBLIC_API_URL);
	const orgs = JSON.parse(getCookie('discovered_orgs'));

	return (
		<>
			<Header heading="Choose a Team" />

			<div>
				{orgs.length > 0 ? (
					<div className={styles.availableTeams}>
						{orgs.map((org: any) => {
							const url = new URL(
								'/auth/select-team',
								import.meta.env.PUBLIC_API_URL,
							);
							url.searchParams.set('org_id', org.id);

							return <a href={url.toString()}>{org.name}</a>;
						})}
					</div>
				) : null}

				<p>or</p>

				<form action={api.toString()} method="POST" className="login-section">
					<label htmlFor="team">Create a Team</label>
					<input id="team" name="organization" type="text" />

					<button type="submit">Create Team</button>
				</form>
			</div>
		</>
	);
};

const Router = () => {
	return (
		<Routes>
			<Route path="dashboard" element={<Layout />}>
				<Route index element={<DashboardHome />} />
				<Route path="add" element={<DashboardAdd />} />
				<Route path="team" element={<DashboardTeamMembers />} />
				<Route path="team-settings" element={<DashboardTeamSettings />} />
				<Route path="account" element={<DashboardAccount />} />

				<Route path="select-team" element={<DashboardSelectTeam />} />

				<Route path="login" element={<DashboardLogin />} />
				<Route path="register" element={<DashboardRegister />} />

				<Route path="*" element={<DashboardLogin />} />
			</Route>
		</Routes>
	);
};

const stytchClient = new StytchB2BHeadlessClient(
	import.meta.env.PUBLIC_STYTCH_TOKEN,
);
const queryClient = new QueryClient();

export const App = () => {
	return (
		<React.StrictMode>
			<StytchB2BProvider stytch={stytchClient}>
				<QueryClientProvider client={queryClient}>
					<BrowserRouter>
						<Router />
					</BrowserRouter>

					<ReactQueryDevtools initialIsOpen={false} />
				</QueryClientProvider>
			</StytchB2BProvider>
		</React.StrictMode>
	);
};
