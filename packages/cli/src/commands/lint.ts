import path from 'path';
import fs from 'fs';
import { AuthordConfig, InstanceProfile, readConfig, TocElement } from '@authord/core';

export async function lintCommand() {
  const projectRoot = process.cwd();
  // let config: AuthordConfig;
  
  // try {
  //   config = await readConfig(projectRoot);
  //   console.log('✓ Configuration valid');
  // } catch (error: any) {
  //   console.error('Configuration error:', error.message);
  //   process.exit(1);
  // }

  // const errors: { path: string; reason: string }[] = [];

  // // Validate topics directory
  // if (config.topics?.dir) {
  //   const topicsDir = path.resolve(projectRoot, config.topics.dir);
    
  //   if (!fs.existsSync(topicsDir)) {
  //     errors.push({
  //       path: config.topics.dir,
  //       reason: 'Topics directory not found'
  //     });
  //   } else if (!fs.statSync(topicsDir).isDirectory()) {
  //     errors.push({
  //       path: config.topics.dir,
  //       reason: 'Topics path is not a directory'
  //     });
  //   }
  // }

  // // Validate images directory
  // if (config.images?.dir) {
  //   const imagesDir = path.resolve(projectRoot, config.images.dir);
    
  //   if (!fs.existsSync(imagesDir)) {
  //     errors.push({
  //       path: config.images.dir,
  //       reason: 'Images directory not found'
  //     });
  //   } else if (!fs.statSync(imagesDir).isDirectory()) {
  //     errors.push({
  //       path: config.images.dir,
  //       reason: 'Images path is not a directory'
  //     });
  //   }
  // }

  // // Validate instances and TOC elements
  // if (config.instances) {
  //   for (const instance of config.instances) {
  //     // Validate start-page
  //     if (instance['start-page']) {
  //       validateTopicFile(
  //         instance, 
  //         instance['start-page'], 
  //         'Start page',
  //         errors,
  //         config.topics?.dir
  //       );
  //     }

  //     // Validate all TOC elements recursively
  //     for (const toc of instance['toc-elements']) {
  //       validateTocElement(
  //         instance, 
  //         toc, 
  //         errors,
  //         config.topics?.dir,
  //         projectRoot
  //       );
  //     }
  //   }
  // }

  // // Output results
  // if (errors.length > 0) {
  //   console.error('\nLint errors found:');
  //   errors.forEach((error, index) => {
  //     console.error(`${index + 1}. ${error.path} - ${error.reason}`);
  //   });
  //   process.exit(1);
  // }

  // console.log('✓ All directories and topic files exist');
  // console.log('\nLint check passed successfully');
  // process.exit(0);
}

// Helper function to validate a single TOC element
function validateTocElement(
  instance: InstanceProfile,
  toc: TocElement,
  errors: { path: string; reason: string }[],
  topicsDir: string | undefined,
  projectRoot: string
) {
  // Validate current topic
  validateTopicFile(
    instance, 
    toc.topic, 
    'TOC element',
    errors,
    topicsDir
  );

  // Validate children recursively
  for (const child of toc.children) {
    validateTocElement(
      instance, 
      child, 
      errors,
      topicsDir,
      projectRoot
    );
  }
}

// Helper function to validate a topic file
function validateTopicFile(
  instance: InstanceProfile,
  topicPath: string,
  context: string,
  errors: { path: string; reason: string }[],
  topicsDir: string | undefined
) {
  if (!topicsDir) {
    errors.push({
      path: topicPath,
      reason: `${context} referenced but topics directory not configured`
    });
    return;
  }

  const fullPath = path.resolve(topicsDir, topicPath);
  
  if (!fs.existsSync(fullPath)) {
    errors.push({
      path: topicPath,
      reason: `${context} for instance '${instance.id}' not found`
    });
  } else if (path.extname(fullPath) !== '.md') {
    errors.push({
      path: topicPath,
      reason: `${context} for instance '${instance.id}' is not a markdown file`
    });
  }
}