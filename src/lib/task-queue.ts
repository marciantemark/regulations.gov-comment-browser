export interface Task<TData = any, TResult = any> {
  id: string;
  dependencies: string[];
  data: TData;
}

export interface QueueOptions {
  concurrency: number;
  onTaskStart?: (task: Task) => void;
  onTaskComplete?: (task: Task, result: any) => void;
  onTaskError?: (task: Task, error: Error) => void;
  onQueueUpdate?: (queueSize: number, runningSize: number, completedSize: number) => void;
}

export class TaskQueue<TData = any, TResult = any> {
  private tasks = new Map<string, Task<TData, TResult>>();
  private completed = new Map<string, TResult>();
  private queue: Task<TData, TResult>[] = [];
  private running = new Map<string, Promise<TResult>>();
  private options: QueueOptions;
  
  constructor(tasks: Task<TData, TResult>[], options: QueueOptions) {
    this.options = options;
    
    // Store all tasks
    for (const task of tasks) {
      this.tasks.set(task.id, task);
    }
  }
  
  // Find tasks that are ready to run
  private findReadyTasks(): Task<TData, TResult>[] {
    const ready: Task<TData, TResult>[] = [];
    
    for (const [id, task] of this.tasks) {
      if (!this.completed.has(id) && 
          !this.running.has(id) && 
          !this.queue.some(t => t.id === id) &&
          task.dependencies.every(dep => this.completed.has(dep))) {
        ready.push(task);
      }
    }
    
    return ready;
  }
  
  // Get completed results
  getCompleted(): Map<string, TResult> {
    return this.completed;
  }
  
  // Get specific result
  getResult(taskId: string): TResult | undefined {
    return this.completed.get(taskId);
  }
  
  // Process all tasks
  async process(
    processor: (task: Task<TData, TResult>, getResult: (id: string) => TResult | undefined) => Promise<TResult>
  ): Promise<Map<string, TResult>> {
    // Initial queue fill
    this.queue.push(...this.findReadyTasks());
    
    if (this.options.onQueueUpdate) {
      this.options.onQueueUpdate(this.queue.length, 0, 0);
    }
    
    while (this.completed.size < this.tasks.size) {
      // Fill worker slots from queue
      while (this.running.size < this.options.concurrency && this.queue.length > 0) {
        const task = this.queue.shift()!;
        
        if (this.options.onTaskStart) {
          this.options.onTaskStart(task);
        }
        
        const promise = processor(task, (id) => this.completed.get(id))
          .then(result => {
            this.completed.set(task.id, result);
            this.running.delete(task.id);
            
            if (this.options.onTaskComplete) {
              this.options.onTaskComplete(task, result);
            }
            
            // Check for newly ready tasks
            const newReady = this.findReadyTasks();
            if (newReady.length > 0) {
              this.queue.push(...newReady);
            }
            
            if (this.options.onQueueUpdate) {
              this.options.onQueueUpdate(
                this.queue.length, 
                this.running.size, 
                this.completed.size
              );
            }
            
            return result;
          })
          .catch(error => {
            this.running.delete(task.id);
            
            if (this.options.onTaskError) {
              this.options.onTaskError(task, error);
            }
            
            throw error;
          });
        
        this.running.set(task.id, promise);
      }
      
      // If no tasks running and queue empty but not done, we have a problem
      if (this.running.size === 0 && this.queue.length === 0 && this.completed.size < this.tasks.size) {
        const remaining = Array.from(this.tasks.keys()).filter(id => !this.completed.has(id));
        throw new Error(`Circular dependency detected. Remaining tasks: ${remaining.join(', ')}`);
      }
      
      // Wait for any task to complete
      if (this.running.size > 0) {
        await Promise.race(this.running.values());
      }
    }
    
    return this.completed;
  }
}

// Helper function to build hierarchical merge tasks
export function buildHierarchicalTasks<T>(
  items: T[],
  getId: (item: T, index: number) => string,
  taskPrefix: string = 'merge',
  mergeWidth: number = 2,
  forceFinalize: boolean = false
): Task<any, any>[] {
  const tasks: Task<any, any>[] = [];
  
  // Add initial items as tasks with no dependencies
  const initialIds = items.map((item, i) => getId(item, i));
  items.forEach((item, i) => {
    tasks.push({
      id: initialIds[i],
      dependencies: [],
      data: { type: 'initial', item }
    });
  });
  
  // Build merge tree
  let currentLevel = initialIds;
  let level = 1;
  
  // Continue merging while we have multiple items OR we need to force finalize a single item
  while (currentLevel.length > 1 || (forceFinalize && currentLevel.length === 1 && level === 1)) {
    const nextLevel: string[] = [];
    
    // Calculate optimal group distribution
    const numGroups = Math.ceil(currentLevel.length / mergeWidth);
    const baseSize = Math.floor(currentLevel.length / numGroups);
    const remainder = currentLevel.length % numGroups;
    
    let startIdx = 0;
    for (let groupIdx = 0; groupIdx < numGroups; groupIdx++) {
      // Distribute remainder items across first groups
      const groupSize = baseSize + (groupIdx < remainder ? 1 : 0);
      const group = currentLevel.slice(startIdx, startIdx + groupSize);
      
      if (group.length > 1 || (forceFinalize && level === 1 && group.length === 1)) {
        const mergeId = `${taskPrefix}_L${level}_P${groupIdx}`;
        tasks.push({
          id: mergeId,
          dependencies: group,
          data: {
            type: 'merge',
            inputs: group
          }
        });
        nextLevel.push(mergeId);
      } else {
        // Single item continues to next level
        nextLevel.push(group[0]);
      }
      
      startIdx += groupSize;
    }
    
    currentLevel = nextLevel;
    level++;
  }
  
  return tasks;
}