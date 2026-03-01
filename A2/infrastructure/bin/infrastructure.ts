#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { InfrastructureStack } from '../lib/infrastructure-stack';

const app = new cdk.App();

// Get the stage from environment variable, default to 'dev'
const stage = process.env.STAGE || 'dev';
const stackName = `TempoFlow-Infra-${stage}`;

new InfrastructureStack(app, stackName, {
  stackName: stackName,
  stage,
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
    region: process.env.CDK_DEFAULT_REGION || process.env.AWS_DEFAULT_REGION,
  },
  // Pass the stage to the stack so it can name resources accordingly
  description: `TempoFlow Infrastructure for stage: ${stage}`,
});

