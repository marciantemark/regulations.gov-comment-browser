#!/usr/bin/env bun
import { Command } from "commander";
import { loadCommentsCommand } from "./commands/load-comments";
import { condenseCommand } from "./commands/condense";
import { discoverThemesCommand } from "./commands/discover-themes";
import { discoverEntitiesCommand } from "./commands/discover-entities";
import { scoreThemesCommand } from "./commands/score-themes";
import { summarizeThemesCommand } from "./commands/summarize-themes";
import { buildWebsiteCommand } from "./website-build-script";
import { pipelineCommand } from "./commands/pipeline";

const program = new Command()
  .name("regulations-comment-analysis")
  .description("Analysis pipeline for public comments from regulations.gov")
  .version("3.0.0");

// Register all commands
program.addCommand(loadCommentsCommand);
program.addCommand(condenseCommand);
program.addCommand(discoverThemesCommand);
program.addCommand(scoreThemesCommand);
program.addCommand(summarizeThemesCommand);
program.addCommand(discoverEntitiesCommand);
program.addCommand(buildWebsiteCommand);
program.addCommand(pipelineCommand);

// Parse and execute
program.parse();

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
