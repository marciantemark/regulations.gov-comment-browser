import { Command } from "commander";
import { loadCommentsCommand } from "./load-comments";
import { condenseCommand } from "./condense";
import { discoverThemesCommand } from "./discover-themes";
import { scoreThemesCommand } from "./score-themes";
import { summarizeThemesCommand } from "./summarize-themes";
import { discoverEntitiesCommand } from "./discover-entities";
import { buildWebsiteCommand } from "../website-build-script";

export const pipelineCommand = new Command("pipeline")
  .description("Run the complete analysis pipeline: load, condense, discover themes, score themes, summarize themes, discover entities, and build website")
  .argument("<document-id>", "Document ID (e.g., CMS-2025-0050-0031)")
  .option("-s, --skip-attachments", "Skip downloading attachments")
  .option("-d, --debug", "Enable debug mode for all steps")
  .option("-o, --output <dir>", "Output directory for website files", "dist/data")
  .option("-l, --limit-total-comment-load <N>", "Limit initial number of comments loaded")
  .option("--start-at <step>", "Start at a specific step (1-7): 1=load, 2=condense, 3=discover-themes, 4=score-themes, 5=summarize-themes, 6=discover-entities, 7=build-website")
  .option("-c, --concurrency <N>", "Number of concurrent operations")
  .option("--max-crashes <N>", "Maximum number of crashes before giving up (default: 10)", parseInt)
  .action(async (documentId: string, options: any) => {
    const startStep = options.startAt ? parseInt(options.startAt) : 1;
    const maxCrashes = options.maxCrashes || 10;
    
    if (isNaN(startStep) || startStep < 1 || startStep > 7) {
      console.error("❌ Invalid start step. Please provide a number between 1 and 7.");
      process.exit(1);
    }
    
    console.log(`🚀 Starting pipeline for ${documentId} at step ${startStep}\n`);
    console.log(`🛡️  Max crashes allowed: ${maxCrashes}`);
    
    const steps = [
      {
        num: 1,
        name: "Loading comments",
        icon: "📥",
        execute: async () => {
          await loadCommentsCommand.parseAsync([
            'bun', 'cli.ts', 
            documentId,
            ...(options.skipAttachments ? ['--skip-attachments'] : []),
            ...(options.debug ? ['--debug'] : []),
            ...(options.limitTotalCommentLoad ? ['--limit', options.limitTotalCommentLoad] : []),
          ]);
        }
      },
      {
        num: 2,
        name: "Condensing comments",
        icon: "📝",
        execute: async () => {
          await condenseCommand.parseAsync([
            'bun', 'cli.ts', 
            documentId,
            ...(options.debug ? ['--debug'] : []),
            ...(options.concurrency ? ['--concurrency', options.concurrency] : []),
          ]);
        }
      },
      {
        num: 3,
        name: "Discovering themes",
        icon: "🔍",
        execute: async () => {
          await discoverThemesCommand.parseAsync([
            'bun', 'cli.ts', 
            documentId,
            ...(options.debug ? ['--debug'] : []),
            ...(options.concurrency ? ['--concurrency', options.concurrency] : []),
          ]);
        }
      },
      {
        num: 4,
        name: "Scoring themes",
        icon: "📊",
        execute: async () => {
          await scoreThemesCommand.parseAsync([
            'bun', 'cli.ts', 
            documentId,
            ...(options.debug ? ['--debug'] : []),
            ...(options.concurrency ? ['--concurrency', options.concurrency] : []),
          ]);
        }
      },
      {
        num: 5,
        name: "Summarizing themes",
        icon: "📄",
        execute: async () => {
          await summarizeThemesCommand.parseAsync([
            'bun', 'cli.ts', 
            documentId,
            ...(options.debug ? ['--debug'] : []),
            ...(options.concurrency ? ['--concurrency', options.concurrency] : []),
          ]);
        }
      },
      {
        num: 6,
        name: "Discovering entities",
        icon: "🏷️",
        execute: async () => {
          await discoverEntitiesCommand.parseAsync([
            'bun', 'cli.ts', 
            documentId,
            ...(options.debug ? ['--debug'] : []),
            ...(options.concurrency ? ['--concurrency', options.concurrency] : []),
          ]);
        }
      },
      {
        num: 7,
        name: "Building website files",
        icon: "🏗️",
        execute: async () => {
          await buildWebsiteCommand.parseAsync([
            'bun', 'cli.ts', 
            documentId,
            '--output', options.output,
          ]);
        }
      }
    ];
    
    let crashCount = 0;
    let currentStep = startStep;
    
    while (currentStep <= 7 && crashCount < maxCrashes) {
      try {
        // Execute only steps from currentStep onwards
        for (const step of steps) {
          if (step.num >= currentStep) {
            console.log(`\n${step.icon} Step ${step.num}/7: ${step.name}...`);
            await step.execute();
            currentStep = step.num + 1; // Move to next step on success
          } else {
            if (crashCount === 0) { // Only log skipping on first attempt
              console.log(`\n⏭️  Skipping step ${step.num}/7: ${step.name}`);
            }
          }
        }
        
        // If we get here, all steps completed successfully
        console.log("\n✅ Pipeline completed successfully!");
        console.log(`📁 Website files are in: ${options.output}`);
        console.log(`🌐 Copy to dashboard/public/data/ and run the dashboard`);
        break; // Exit the retry loop
        
      } catch (error) {
        crashCount++;
        console.error(`\n💥 Pipeline crashed at step ${currentStep} (crash ${crashCount}/${maxCrashes}):`, error);
        
        if (crashCount >= maxCrashes) {
          console.error(`\n❌ Pipeline failed after ${maxCrashes} crashes. Giving up.`);
          process.exit(1);
        } else {
          console.log(`\n🔄 Restarting from step ${currentStep} in 5 seconds...`);
          await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds before retry
        }
      }
    }
  }); 
