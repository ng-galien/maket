import { asFunction } from "awilix";
import { z } from "zod";
import type { ToolHandler } from "../core/container.js";
import type { ToolPack } from "../core/tool-pack.js";
import {
	LEARN_TOPICS,
	type LearnAudience,
	type LearnTopic,
	learnText,
	learnTopicTitle,
} from "../lib/learn-content.js";
import { text } from "./_helpers.js";

const ActionSchema = z.enum(["overview", "topics", "topic"]);
const TopicSchema = z.enum(LEARN_TOPICS);
const AudienceSchema = z.enum(["agent", "human"]);

const MaketLearnSchema = z.object({
	action: ActionSchema.optional().describe("Default: overview."),
	topic: TopicSchema.optional().describe("Required for action=topic."),
	audience: AudienceSchema.optional().describe("Default: agent."),
});

const DESCRIPTION = [
	"When to use: first call for any agent entering Maket; source of operational guidance for using Maket MCP tools correctly.",
	"",
	"Returns structured Markdown inside MCP text content. It teaches agents how to operate Maket: workflow, HTML composition, chartes, diagram styling, collections, living document state, review loop, and client installation.",
	"This is not the user-facing Help document opened from the Maket UI.",
	"",
	"Actions:",
	"  overview — short operating model.",
	"  topics   — list available topics.",
	"  topic    — read one topic with topic=<name>.",
].join("\n");

export function createMaketLearnTool(): ToolHandler {
	return {
		metadata: {
			name: "maket_learn",
			description: DESCRIPTION,
			schema: MaketLearnSchema,
		},
		handler: async (rawArgs) => runLearn(rawArgs),
	};
}

type Args = z.infer<typeof MaketLearnSchema>;

function runLearn(rawArgs: unknown) {
	const parsed = MaketLearnSchema.safeParse(rawArgs);
	if (!parsed.success) return text(parsed.error.message, true);
	const args = parsed.data;
	if ((args.action ?? "overview") === "topics") return runTopics();
	if ((args.action ?? "overview") === "topic") return runTopic(args);
	return runOverview(args);
}

function runOverview(args: Args) {
	const audience = learnAudience(args);
	return text(learnText("overview", audience), {
		next: [
			"maket_learn action=topics",
			"maket_learn action=topic topic=workflow",
			"maket_workspace action=state doc=<doc>",
		],
	});
}

function runTopics() {
	const lines = LEARN_TOPICS.map(
		(topic) => `- \`${topic}\` — ${learnTopicTitle(topic)}`,
	);
	return text(
		[
			"# Maket Learn topics",
			"Choose the smallest topic that covers the current task. Read multiple focused topics when a workflow crosses boundaries.",
			"## Available topics",
			lines.join("\n"),
			"## Recommended path",
			"Start with `overview`, use `tools` to choose the public surface, continue with `workflow`, then read the capability-specific topic.",
		].join("\n\n"),
		{
			next: [
				"maket_learn action=topic topic=tools",
				"maket_learn action=topic topic=html",
				"maket_learn action=topic topic=diagrams",
				"maket_learn action=topic topic=state",
			],
		},
	);
}

function runTopic(args: Args) {
	if (!args.topic) return text("topic is required for action=topic", true);
	const audience = learnAudience(args);
	return text(learnText(args.topic as LearnTopic, audience));
}

function learnAudience(args: Args): LearnAudience {
	return args.audience ?? "agent";
}

export const learnPack: ToolPack = {
	id: "learn",
	name: "Learn",
	declaresTools: ["maket_learn"],
	register(container) {
		container.register({
			maketLearnTool: asFunction(createMaketLearnTool).singleton(),
		});
	},
};
