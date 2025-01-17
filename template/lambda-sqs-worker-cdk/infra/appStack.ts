import type { StackProps } from 'aws-cdk-lib';
import {
  Stack,
  aws_iam,
  aws_kms,
  aws_lambda,
  aws_lambda_event_sources,
  aws_sns,
  aws_sns_subscriptions,
  aws_sqs,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import { EnvContextSchema, StageContextSchema } from '../shared/context-types';

export class AppStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const stage = StageContextSchema.parse(this.node.tryGetContext('stage'));
    const context = EnvContextSchema.parse(this.node.tryGetContext(stage));

    const accountPrincipal = new aws_iam.AccountPrincipal(this.account);

    const kmsKey = new aws_kms.Key(this, 'kms-key', {
      description: '<%- serviceName %>',
      enableKeyRotation: true,
      admins: [accountPrincipal],
      alias: 'seek/self/<%- serviceName %>',
    });

    kmsKey.grantEncrypt(accountPrincipal);

    const topic = new aws_sns.Topic(this, 'topic', {
      topicName: '<%- serviceName %>',
      masterKey: kmsKey,
    });

    const deadLetterQueue = new aws_sqs.Queue(this, 'worker-queue-dlq', {
      queueName: '<%- serviceName %>-dlq',
      encryptionMasterKey: kmsKey,
    });

    const queue = new aws_sqs.Queue(this, 'worker-queue', {
      queueName: '<%- serviceName %>',
      deadLetterQueue: {
        maxReceiveCount: 3,
        queue: deadLetterQueue,
      },
      encryptionMasterKey: kmsKey,
    });

    const architecture = '<%- lambdaCdkArchitecture %>';

    const worker = new aws_lambda.Function(this, 'worker', {
      architecture: aws_lambda.Architecture[architecture],
      code: new aws_lambda.AssetCode('./lib'),
      runtime: aws_lambda.Runtime.NODEJS_18_X,
      handler: 'app.handler',
      functionName: '<%- serviceName %>',
      environmentEncryption: kmsKey,
      environment: {
        NODE_ENV: 'production',
        // https://nodejs.org/api/cli.html#cli_node_options_options
        NODE_OPTIONS: '--enable-source-maps',
        ...context.workerLambda.environment,
      },
    });

    worker.addEventSource(new aws_lambda_event_sources.SqsEventSource(queue));

    topic.addSubscription(new aws_sns_subscriptions.SqsSubscription(queue));
  }
}
