#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { InfrastructureStack } from '../lib/infrastructure-stack';
import { WebAppStack } from '../lib/web-app-stack';

const app = new cdk.App();

// Get the stage from environment variable, default to 'dev'
const stage = process.env.STAGE || 'dev';
const stackName = `TempoFlow-Infra-${stage}`;
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
  region: process.env.CDK_DEFAULT_REGION || process.env.AWS_DEFAULT_REGION,
};

const infra = new InfrastructureStack(app, stackName, {
  stackName: stackName,
  stage,
  env,
  description: `TempoFlow Infrastructure for stage: ${stage}`,
});

// Next.js web app (ECS Fargate + ALB). Opt-in — set DEPLOY_WEB_STACK=1 (adds ALB + Fargate cost).
if (process.env.DEPLOY_WEB_STACK === '1') {
  new WebAppStack(app, `TempoFlow-Web-${stage}`, {
    stackName: `TempoFlow-Web-${stage}`,
    stage,
    userVideoBucket: infra.userVideoBucket,
    env,
    description: `TempoFlow web app (Fargate) for stage: ${stage}`,
  });
}
