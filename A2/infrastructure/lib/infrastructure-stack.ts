import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

interface InfrastructureStackProps extends cdk.StackProps {
  stage?: string;
}

export class InfrastructureStack extends cdk.Stack {
  public readonly userVideoBucket: s3.Bucket;
  public readonly referenceVideoBucket: s3.Bucket;
  public readonly validationVideoBucket: s3.Bucket;
  public readonly audioValidationBucket: s3.Bucket;
  
  public readonly usersTable: dynamodb.Table;
  public readonly sessionsTable: dynamodb.Table;
  
  constructor(scope: Construct, id: string, props?: InfrastructureStackProps) {
    super(scope, id, props);

    const stage = props?.stage ?? process.env.STAGE ?? 'dev';
    const isProd = stage === 'prod';
    const removalPolicy = isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;


    // ========================================================================
    // S3 Storage Buckets
    // ========================================================================

    // 1. User Video Uploads
    this.userVideoBucket = new s3.Bucket(this, `${stage}-UserVideoBucket`, {
      versioned: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.POST, s3.HttpMethods.GET],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
        },
      ],
      removalPolicy,
      autoDeleteObjects: !isProd,
    });

    // 2. Reference Videos (Source of Truth)
    this.referenceVideoBucket = new s3.Bucket(this, `${stage}-ReferenceVideoBucket`, {
      versioned: isProd,
      encryption: s3.BucketEncryption.S3_MANAGED,
      cors: [{ allowedMethods: [s3.HttpMethods.GET], allowedOrigins: ['*'], allowedHeaders: ['*'] }],
      removalPolicy,
      autoDeleteObjects: !isProd,
    });

    // 3. Validation Videos (Dancer Alignment Pipeline)
    this.validationVideoBucket = new s3.Bucket(this, `${stage}-ValidationVideoBucket`, {
        versioned: false,
        publicReadAccess: false,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        removalPolicy,
        autoDeleteObjects: !isProd,
        cors: [{ allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT], allowedOrigins: ['*'], allowedHeaders: ['*'] }],
    });

    // 4. Audio Validation Data (GTZAN/DEMAND + generated clips)
    this.audioValidationBucket = new s3.Bucket(this, `${stage}-AudioValidationBucket`, {
      versioned: isProd,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      cors: [{ allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT], allowedOrigins: ['*'], allowedHeaders: ['*'] }],
      removalPolicy,
      autoDeleteObjects: !isProd,
    });

    // ========================================================================
    // DynamoDB Data Models
    // ========================================================================

    // 1. Users Table
    // PK: userId (String)
    this.usersTable = new dynamodb.Table(this, `${stage}-UsersTable`, {
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: isProd,
      },
      removalPolicy,
    });

    // 2. Sessions Table (Stores dance attempts and scores)
    // PK: sessionId (String), SK: userId (String)
    // GSI: userId (to query all sessions for a user)
    this.sessionsTable = new dynamodb.Table(this, `${stage}-SessionsTable`, {
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sessionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: isProd,
      },
      removalPolicy,
    });

    // Outputs
    new cdk.CfnOutput(this, 'Stage', { value: stage });
    new cdk.CfnOutput(this, 'UserVideoBucketName', { value: this.userVideoBucket.bucketName });
    new cdk.CfnOutput(this, 'ReferenceVideoBucketName', { value: this.referenceVideoBucket.bucketName });
    new cdk.CfnOutput(this, 'ValidationVideoBucketName', { value: this.validationVideoBucket.bucketName });
    new cdk.CfnOutput(this, 'AudioValidationBucketName', { value: this.audioValidationBucket.bucketName });
    new cdk.CfnOutput(this, 'UsersTableName', { value: this.usersTable.tableName });
    new cdk.CfnOutput(this, 'SessionsTableName', { value: this.sessionsTable.tableName });
  }
}
