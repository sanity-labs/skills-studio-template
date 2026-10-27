/**
 * Skills Studio configuration — the ONE file to edit when you fork this
 * template. Everything org-specific (Sanity project, GitHub repo, names shown
 * in the marketplace and the Studio, SSO) is read from here by the Studio,
 * the Functions, the scripts and the automation stack.
 *
 * Run `pnpm run setup` from the repo root to fill this in interactively, or edit
 * the values by hand. See README.md § "Set up your own Skills Studio".
 */
export const skillsConfig = {
  /** Your organization's name, used in UI copy and generated plugin metadata. */
  orgName: 'Acme',

  sanity: {
    /** Sanity project that stores the skills (sanity.io/manage). */
    projectId: 'your-project-id',
    dataset: 'production',
    /** Sanity organization ID. Only needed for the optional automation stack. */
    organizationId: '',
    /**
     * Hostname for `sanity deploy` → https://<studioHost>.sanity.studio.
     * Must be globally unique across Sanity.
     */
    studioHost: 'acme-skills-studio',
    /**
     * Deployed Studio app ID. Leave empty for the first deploy; `sanity deploy`
     * prints the ID afterwards — paste it here so later deploys reuse it.
     */
    appId: '',
  },

  /**
   * Optional SAML SSO. Leave `samlLoginUrl` empty to use Sanity's standard
   * login (Google, GitHub, email). With SSO configured for your Sanity org,
   * paste its login URL, e.g.
   * https://api.sanity.io/v2021-10-01/auth/saml/login/<id>
   */
  auth: {
    samlLoginUrl: '',
  },

  github: {
    /** GitHub org or user that owns the skills repo (this fork). */
    owner: 'acme',
    /** Repository name. */
    repo: 'skills',
    branch: 'main',
  },

  marketplace: {
    /**
     * Marketplace name used in install commands:
     * `claude plugin install <plugin>@<marketplace name>`.
     */
    name: 'acme-skills',
    displayName: 'Acme Skills',
    description: 'AI agent skills for Acme teams.',
    author: {name: 'Acme', email: 'ai@acme.example', url: 'https://acme.example'},
  },

  /**
   * Plugin folder for the org-wide "Everyone" audience. Its overview skill is
   * the cross-plugin catalog. Give the Everyone audience document this value
   * as its Plugin Name Override (the seed script does this for you).
   */
  everyonePluginName: 'org-skills',
} as const

export const REPO_URL = `https://github.com/${skillsConfig.github.owner}/${skillsConfig.github.repo}`

/** Public Studio URL, used for deep links in digests and docs. */
export const STUDIO_URL = `https://${skillsConfig.sanity.studioHost}.sanity.studio`
