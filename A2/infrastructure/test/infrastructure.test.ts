import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { InfrastructureStack } from '../lib/infrastructure-stack';

describe('InfrastructureStack', () => {
	test('creates expected S3 and DynamoDB resources', () => {
		const app = new cdk.App();
		const stack = new InfrastructureStack(app, 'TempoFlow-Infra-dev', { stage: 'dev' });
		const template = Template.fromStack(stack);

		template.resourceCountIs('AWS::S3::Bucket', 4);
		template.resourceCountIs('AWS::DynamoDB::Table', 2);
		template.hasOutput('AudioValidationBucketName', {});
		template.hasOutput('ValidationVideoBucketName', {});
	});

	test('prod enables PITR on DynamoDB tables', () => {
		const app = new cdk.App();
		const stack = new InfrastructureStack(app, 'TempoFlow-Infra-prod', { stage: 'prod' });
		const template = Template.fromStack(stack);

		template.hasResourceProperties('AWS::DynamoDB::Table', {
			PointInTimeRecoverySpecification: {
				PointInTimeRecoveryEnabled: true,
			},
			KeySchema: Match.arrayWith([
				Match.objectLike({ AttributeName: 'userId' }),
			]),
		});
	});
});
