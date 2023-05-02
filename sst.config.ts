import { SSTConfig } from "sst";
import { API } from "./stacks/API";
import { SimpleTable } from "./stacks/Table";
import { StepFunction } from "./stacks/StepFunction";
import { TransformStepFunction } from "./stacks/TransformStepFunction";

export default {
  config(_input) {
    return {
      name: "apigw-sfn-transformation",
      region: "us-east-2",
    };
  },
  stacks(app) {
    app.stack(SimpleTable)
    .stack(StepFunction)
    .stack(TransformStepFunction)
    .stack(API);
  }
} satisfies SSTConfig;
