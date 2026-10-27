import Link from 'next/link';
import GuideArticle from '@/components/guides/GuideArticle';
import { REPOSITORY_URL } from '@/components/RepositoryLink';
import { APP_NAME, siteUrl } from '@/lib/branding';
import { GUIDES, guideMetadata } from '@/lib/guides';

export function generateMetadata() {
  return guideMetadata(GUIDES.connect);
}

export default function ConnectChatGptClaudePage() {
  // Named from the deployment's own origin, so a self-hosted copy shows its own address.
  const server = `${siteUrl()}/api/mcp`;
  return (
    <GuideArticle guide={GUIDES.connect}>
      <p>
        Connect ChatGPT or Claude to your {APP_NAME} library and ask for your prompts from the chat
        instead of copying them in. The assistant writes and revises the prompt text in the
        conversation, on your own ChatGPT or Claude plan, and the connection stores and fetches it.
        You need an account on this site, but no API key or AI provider.
      </p>

      <h2>What the assistant can do with your library</h2>
      <ul>
        <li>List your saved prompts, optionally only one folder or your favourites.</li>
        <li>Open a prompt with its sections and the hints for its variables.</li>
        <li>Save a new prompt, or update one you already have.</li>
        <li>List a prompt&apos;s earlier versions.</li>
      </ul>
      <p>
        Every update keeps the previous version in the prompt&apos;s history, so you can compare and
        restore it in the app. The assistant cannot delete prompts or restore old versions.
      </p>

      <h2>Connect Claude</h2>
      <ol>
        <li>
          In Claude, open <strong>Customize → Connectors</strong> and choose{' '}
          <strong>Add custom connector</strong>. On a Team or Enterprise plan, an Owner adds it under{' '}
          <strong>Organization settings → Connectors</strong>, and each member then connects.
        </li>
        <li>
          Enter <code>{server}</code> as the server URL. Leave the OAuth client ID and secret empty.
          If asked, choose <strong>Sign in now</strong> and <strong>Register automatically</strong>.
        </li>
        <li>Sign in on this site when Claude sends you here, and allow access.</li>
        <li>In a conversation, turn the connector on from the <strong>+</strong> menu under <strong>Connectors</strong>.</li>
      </ol>
      <p>
        Custom connectors are available on every Claude plan, including one on the free plan.
        Anthropic&apos;s <a href="https://claude.com/docs/connectors/custom/add-unlisted">connector guide</a>{' '}
        has the current steps. In Claude Code, run{' '}
        <code>claude mcp add --transport http prompt-maker {server}</code>, then sign in with{' '}
        <code>/mcp</code>.
      </p>

      <h2>Connect ChatGPT</h2>
      <ol>
        <li>
          Add a custom remote MCP server. Where to find it depends on your ChatGPT plan; OpenAI&apos;s{' '}
          <a href="https://developers.openai.com/plugins/deploy/connect-chatgpt">connection guide</a> shows
          the current place.
        </li>
        <li>
          Enter <code>{server}</code> as the server URL and choose OAuth sign-in. Leave the client
          credentials empty: ChatGPT registers itself.
        </li>
        <li>Sign in on this site when ChatGPT sends you here, and allow access.</li>
      </ol>

      <h2>Ask for your prompts in plain words</h2>
      <ul>
        <li>&quot;Help me write a prompt for a customer-support assistant, then save it as Support reply.&quot;</li>
        <li>&quot;Show my saved prompts in the Marketing folder.&quot;</li>
        <li>&quot;Open my Support reply prompt, make it more concise, and save the new version.&quot;</li>
      </ul>
      <p>
        A prompt saved from the chat appears in your library at once. Fill it in there, or keep
        improving it with the techniques in{' '}
        <Link href={GUIDES.goodPrompt.path}>what makes a good AI prompt</Link>.
      </p>

      <h2>Disconnect</h2>
      <p>
        Remove the connector in ChatGPT or Claude to stop it calling this site. In the app,{' '}
        <strong>Settings → ChatGPT and Claude</strong> lists the connected apps with a{' '}
        <strong>Disconnect</strong> button for each; <strong>Sign out everywhere</strong> cuts off
        all of them at once. Running your own copy? The{' '}
        <a href={`${REPOSITORY_URL}/blob/main/docs/mcp.md`}>technical documentation</a> covers the
        server side.
      </p>
    </GuideArticle>
  );
}
