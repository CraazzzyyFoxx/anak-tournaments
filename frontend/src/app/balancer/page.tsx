"use client";

import React, { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, FileJson, Loader2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import balancerService from "@/services/balancer.service";
import BalancerResults from "./components/BalancerResults";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const BalancerPage = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const { mutate, data, isPending, isError, error, reset } = useMutation({
    mutationFn: (file: File) => balancerService.balanceTeams(file),
    onSuccess: () => {
      console.log("Teams balanced successfully");
    }
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      reset();
    }
  };

  const handleSubmit = () => {
    if (!selectedFile) {
      return;
    }
    mutate(selectedFile);
  };

  const handleReset = () => {
    setSelectedFile(null);
    reset();
  };

  return (
    <div className="container p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Tournament Team Balancer</h1>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileJson className="h-5 w-5" />
            Upload Player Data
          </CardTitle>
          <CardDescription>
            Upload a JSON file containing player information for team balancing
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex gap-4 items-end">
              <div className="flex-1">
                <Input
                  type="file"
                  accept=".json"
                  onChange={handleFileChange}
                  disabled={isPending}
                  className="cursor-pointer"
                />
              </div>
              <Button
                onClick={handleSubmit}
                disabled={!selectedFile || isPending}
                className="min-w-[120px]"
              >
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Balancing...
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />
                    Balance Teams
                  </>
                )}
              </Button>
              {(selectedFile || data) && (
                <Button onClick={handleReset} variant="outline">
                  Reset
                </Button>
              )}
            </div>

            {selectedFile && !data && (
              <div className="text-sm text-muted-foreground">
                Selected: <span className="font-medium">{selectedFile.name}</span> (
                {(selectedFile.size / 1024).toFixed(2)} KB)
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {isError && (
        <Alert variant="destructive" className="mb-8">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            {error instanceof Error ? error.message : "An error occurred while balancing teams"}
          </AlertDescription>
        </Alert>
      )}

      {data && <BalancerResults results={data} />}
    </div>
  );
};

export default BalancerPage;
